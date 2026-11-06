import { describe, expect, it } from "vitest";
import {
  computeAttendanceStatus,
  computeCheckOut,
  getCheckInFlags,
  getNextAction,
  getRecordCloseTime,
  resolveEffectiveSchedule,
} from "./attendance.rules.js";
import { TEST_TIMEZONES, useProcessTimezone } from "../../test/timezone.js";

const SETTINGS = {
  workingDays: { mon: "FULL", tue: "FULL", wed: "FULL", thu: "FULL", fri: "FULL", sat: "HALF", sun: "OFF" } as const,
  workStartTime: "09:00",
  workEndTime: "17:00",
  halfDayEndTime: "13:00",
  lateGraceMinutes: 10,
};

const TUESDAY = "2026-11-03";
const SATURDAY = "2026-11-07";
const SUNDAY = "2026-11-08";

function schedule(overrides: Partial<Parameters<typeof resolveEffectiveSchedule>[0]> = {}) {
  return resolveEffectiveSchedule({
    workDate: TUESDAY,
    timezone: "Asia/Colombo",
    settings: SETTINGS,
    isHoliday: false,
    leave: null,
    ...overrides,
  });
}

// The server's own timezone must never matter, so all of this runs under both.
describe.each(TEST_TIMEZONES)("attendance rules with server TZ=$tz", ({ tz, offsetMinutes }) => {
  useProcessTimezone(tz, offsetMinutes);

  describe("resolveEffectiveSchedule", () => {
    it("turns a working day's wall-clock times into instants, in the company's timezone", () => {
      expect(schedule()).toMatchObject({
        dayType: "WORKING",
        scheduledStartAt: new Date("2026-11-03T03:30:00.000Z"),
        scheduledEndAt: new Date("2026-11-03T11:30:00.000Z"),
      });
    });

    it("uses the company's timezone, not Colombo's, for another company", () => {
      expect(schedule({ timezone: "Europe/London" }).scheduledStartAt).toEqual(new Date("2026-11-03T09:00:00.000Z"));
    });

    it("ends a night shift on the next day", () => {
      const night = schedule({ settings: { ...SETTINGS, workStartTime: "22:00", workEndTime: "06:00" } });
      expect(night.scheduledStartAt).toEqual(new Date("2026-11-03T16:30:00.000Z"));
      expect(night.scheduledEndAt).toEqual(new Date("2026-11-04T00:30:00.000Z"));
    });

    it("ends a HALF day at the half-day end time", () => {
      const half = schedule({ workDate: SATURDAY });
      expect(half.dayType).toBe("HALF");
      expect(half.endTime).toBe("13:00");
    });

    it("works a HALF day in full when the shift starts at or after the half-day end", () => {
      const night = schedule({ workDate: SATURDAY, settings: { ...SETTINGS, workStartTime: "22:00", workEndTime: "06:00" } });
      expect(night).toMatchObject({ dayType: "WORKING", endTime: "06:00" });

      const atTheEnd = schedule({ workDate: SATURDAY, settings: { ...SETTINGS, workStartTime: "13:00", workEndTime: "20:00" } });
      expect(atTheEnd).toMatchObject({ dayType: "WORKING", endTime: "20:00" });
    });

    it("gives a weekly off day no schedule", () => {
      expect(schedule({ workDate: SUNDAY })).toMatchObject({ dayType: "OFF", startTime: null, scheduledStartAt: null, scheduledEndAt: null });
    });

    it("gives a holiday no schedule, and a holiday beats leave", () => {
      expect(schedule({ isHoliday: true, leave: "FULL" })).toMatchObject({ dayType: "HOLIDAY", scheduledStartAt: null });
    });

    it("doesn't count leave on a weekly off day as a leave day", () => {
      expect(schedule({ workDate: SUNDAY, leave: "FULL" }).dayType).toBe("OFF");
    });

    it("keeps the schedule on a leave day, because the person may still check in", () => {
      const leave = schedule({ leave: "FULL" });
      expect(leave.dayType).toBe("ON_LEAVE");
      expect(leave.scheduledStartAt).not.toBeNull();
    });

    it("marks half a day's leave", () => {
      expect(schedule({ leave: "HALF" })).toMatchObject({ dayType: "WORKING", isHalfDayLeave: true });
    });
  });

  describe("getCheckInFlags", () => {
    it.each([
      ["a normal day", {}, []],
      ["a weekly off day", { workDate: SUNDAY }, ["NON_WORKING_DAY"]],
      ["a holiday", { isHoliday: true }, ["NON_WORKING_DAY"]],
      ["approved leave", { leave: "FULL" as const }, ["ON_APPROVED_LEAVE"]],
      ["half a day's leave", { leave: "HALF" as const }, ["HALF_DAY_LEAVE"]],
    ])("%s", (_label, overrides, flags) => {
      expect(getCheckInFlags(schedule(overrides))).toEqual(flags);
    });
  });

  describe("computeAttendanceStatus", () => {
    const at = (time: string) => ({ checkInAt: new Date(`2026-11-03T${time}+05:30`), checkOutAt: null, autoClosedAt: null });

    it.each([
      ["early", "08:00:00", "PRESENT", 0],
      ["on time", "09:00:00", "PRESENT", 0],
      ["within grace", "09:05:00", "PRESENT", 0],
      ["exactly at the end of grace", "09:10:00", "PRESENT", 0],
      ["one second after grace, counted from the start", "09:10:01", "LATE", 10],
      ["twelve minutes late", "09:12:00", "LATE", 12],
      ["rounding down", "09:12:59", "LATE", 12],
    ])("%s", (_label, time, status, lateMinutes) => {
      expect(computeAttendanceStatus(at(time), schedule())).toEqual({ status, lateMinutes });
    });

    it("is never late with no schedule", () => {
      expect(computeAttendanceStatus(at("23:00:00"), schedule({ workDate: SUNDAY }))).toEqual({ status: "PRESENT", lateMinutes: 0 });
    });

    it("is never late on half a day's leave", () => {
      expect(computeAttendanceStatus(at("13:30:00"), schedule({ leave: "HALF" }))).toEqual({ status: "PRESENT", lateMinutes: 0 });
    });

    it("can be late on a full leave day", () => {
      expect(computeAttendanceStatus(at("09:30:00"), schedule({ leave: "FULL" }))).toEqual({ status: "LATE", lateMinutes: 30 });
    });

    it("INCOMPLETE beats LATE when the day was closed with no check-out, and keeps the lateness", () => {
      const closed = { ...at("09:30:00"), autoClosedAt: new Date("2026-11-03T15:30:00.000Z") };
      expect(computeAttendanceStatus(closed, schedule())).toEqual({ status: "INCOMPLETE", lateMinutes: 30 });
    });

    it("a checked-out record isn't INCOMPLETE", () => {
      const done = { ...at("09:00:00"), checkOutAt: new Date("2026-11-03T11:30:00.000Z"), autoClosedAt: new Date("2026-11-03T15:30:00.000Z") };
      expect(computeAttendanceStatus(done, schedule()).status).toBe("PRESENT");
    });
  });

  describe("computeCheckOut", () => {
    const base = {
      checkInAt: new Date("2026-11-03T03:30:00.000Z"),
      scheduledEndAt: new Date("2026-11-03T11:30:00.000Z"),
      flags: [] as string[],
    };

    it("counts whole minutes worked, rounding down", () => {
      expect(computeCheckOut({ ...base, checkOutAt: new Date("2026-11-03T11:30:59.000Z") }).workedMinutes).toBe(480);
    });

    it("records leaving early", () => {
      expect(computeCheckOut({ ...base, checkOutAt: new Date("2026-11-03T11:00:00.000Z") }).earlyLeaveMinutes).toBe(30);
    });

    it("leaving late isn't a negative early leave", () => {
      expect(computeCheckOut({ ...base, checkOutAt: new Date("2026-11-03T12:00:00.000Z") }).earlyLeaveMinutes).toBe(0);
    });

    it("has no early leave with no schedule", () => {
      expect(computeCheckOut({ ...base, scheduledEndAt: null, checkOutAt: new Date("2026-11-03T04:00:00.000Z") }).earlyLeaveMinutes).toBe(0);
    });

    it("doesn't judge leaving early on half a day's leave", () => {
      const outcome = computeCheckOut({ ...base, flags: ["HALF_DAY_LEAVE"], checkOutAt: new Date("2026-11-03T07:00:00.000Z") });
      expect(outcome.earlyLeaveMinutes).toBe(0);
    });

    it("flags a shift longer than 16 hours, and only then", () => {
      const sixteen = new Date(base.checkInAt.getTime() + 16 * 3_600_000);
      expect(computeCheckOut({ ...base, checkOutAt: sixteen }).flags).toEqual([]);
      const over = new Date(sixteen.getTime() + 60_000);
      expect(computeCheckOut({ ...base, flags: ["ON_APPROVED_LEAVE"], checkOutAt: over }).flags).toEqual(["ON_APPROVED_LEAVE", "LONG_SHIFT"]);
    });
  });

  describe("getRecordCloseTime", () => {
    it("is the scheduled end plus the auto-checkout minutes", () => {
      const close = getRecordCloseTime({ scheduledEndAt: new Date("2026-11-03T11:30:00.000Z"), checkInAt: new Date("2026-11-03T03:30:00.000Z") }, 240);
      expect(close).toEqual(new Date("2026-11-03T15:30:00.000Z"));
    });

    it("is 16 hours after the check-in with no schedule", () => {
      expect(getRecordCloseTime({ scheduledEndAt: null, checkInAt: new Date("2026-11-08T03:30:00.000Z") }, 240)).toEqual(new Date("2026-11-08T19:30:00.000Z"));
    });

    it("is unknown with neither", () => {
      expect(getRecordCloseTime({ scheduledEndAt: null, checkInAt: null }, 240)).toBeNull();
    });
  });

  describe("getNextAction", () => {
    const shiftEnd = new Date("2026-11-03T11:30:00.000Z");
    const beforeClose = new Date("2026-11-03T12:00:00.000Z");
    const atClose = new Date("2026-11-03T15:30:00.000Z");
    const open = { checkInAt: new Date("2026-11-03T03:30:00.000Z"), checkOutAt: null, autoClosedAt: null, scheduledEndAt: shiftEnd };
    const action = (record: typeof open | null | Record<string, unknown>, now: Date, end: Date | null = shiftEnd) =>
      getNextAction({ record: record as typeof open | null, schedule: { scheduledEndAt: end }, autoCheckoutAfterMinutes: 240, now });

    it("no record, before the close time: check in", () => {
      expect(action(null, beforeClose)).toBe("CHECK_IN");
    });

    it("no record, at the close time: closed", () => {
      expect(action(null, atClose)).toBe("DAY_CLOSED");
    });

    it("no record and no schedule: can always check in", () => {
      expect(action(null, atClose, null)).toBe("CHECK_IN");
    });

    it("a row day close wrote, with no check-in: closed", () => {
      expect(action({ ...open, checkInAt: null }, beforeClose)).toBe("DAY_CLOSED");
    });

    it("checked in: check out, until the close time", () => {
      expect(action(open, beforeClose)).toBe("CHECK_OUT");
      expect(action(open, atClose)).toBe("DAY_CLOSED");
    });

    it("auto-closed: closed, even before the close time", () => {
      expect(action({ ...open, autoClosedAt: beforeClose }, beforeClose)).toBe("DAY_CLOSED");
    });

    it("checked out: done, even after the close time", () => {
      expect(action({ ...open, checkOutAt: shiftEnd }, atClose)).toBe("DONE");
    });
  });
});
