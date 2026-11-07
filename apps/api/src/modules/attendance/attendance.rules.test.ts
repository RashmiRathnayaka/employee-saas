import { describe, expect, it } from "vitest";
import {
  applyScheduleOverride,
  computeAttendanceStatus,
  computeCheckOut,
  computeCorrectedRecord,
  getCheckInFlags,
  getLeaveKindOnDate,
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

    describe("with a per-employee override", () => {
      const NIGHT = { startTime: "22:00", endTime: "06:00", workingDays: null, lateGraceMinutes: null };

      it("takes the override's hours, and keeps the company's other values", () => {
        const settings = applyScheduleOverride(SETTINGS, NIGHT);
        expect(settings).toMatchObject({ workStartTime: "22:00", workEndTime: "06:00", lateGraceMinutes: 10, workingDays: SETTINGS.workingDays, halfDayEndTime: "13:00" });
      });

      it("takes the override's week and grace when it has them", () => {
        const week = { ...SETTINGS.workingDays, sun: "FULL" as const };
        const settings = applyScheduleOverride(SETTINGS, { ...NIGHT, workingDays: week, lateGraceMinutes: 0 });
        expect(settings).toMatchObject({ workingDays: week, lateGraceMinutes: 0 });
        expect(schedule({ workDate: SUNDAY, settings }).dayType).toBe("WORKING");
      });

      it("a grace of 0 is a value, not 'follow the company'", () => {
        expect(applyScheduleOverride(SETTINGS, { ...NIGHT, lateGraceMinutes: 0 }).lateGraceMinutes).toBe(0);
      });

      it("no override: the company's settings, unchanged", () => {
        expect(applyScheduleOverride(SETTINGS, null)).toBe(SETTINGS);
      });

      describe("a HALF day is the first half of the override's shift", () => {
        it.each([
          ["a night shift crossing midnight", "22:00", "06:00", "02:00"],
          ["a day shift running past the company's half-day end", "11:00", "19:00", "15:00"],
          ["a shift over before the half-day end", "06:00", "10:00", "08:00"],
          ["a shift whose half ends before midnight", "18:00", "23:00", "20:30"],
          ["a night shift whose half ends at midnight exactly", "20:00", "04:00", "00:00"],
          ["an odd minute rounds down", "09:00", "18:01", "13:30"],
        ])("%s: %s-%s ends at %s", (_label, startTime, endTime, halfEnd) => {
          const half = schedule({ workDate: SATURDAY, settings: applyScheduleOverride(SETTINGS, { ...NIGHT, startTime, endTime }) });
          expect(half).toMatchObject({ dayType: "HALF", startTime, endTime: halfEnd });
        });

        it("the night shift ends on the next date, in company time", () => {
          const half = schedule({ workDate: SATURDAY, settings: applyScheduleOverride(SETTINGS, NIGHT) });
          expect(half.scheduledStartAt).toEqual(new Date("2026-11-07T16:30:00.000Z"));
          expect(half.scheduledEndAt).toEqual(new Date("2026-11-07T20:30:00.000Z")); // 02:00 on the 8th
        });

        it("a half ending at exactly midnight ends on the next date", () => {
          const half = schedule({ workDate: SATURDAY, settings: applyScheduleOverride(SETTINGS, { ...NIGHT, startTime: "20:00", endTime: "04:00" }) });
          expect(half.scheduledEndAt).toEqual(new Date("2026-11-07T18:30:00.000Z")); // 00:00 on the 8th
        });

        it("half a day's leave on it keeps the same times", () => {
          const half = schedule({ workDate: SATURDAY, leave: "HALF", settings: applyScheduleOverride(SETTINGS, NIGHT) });
          expect(half).toMatchObject({ dayType: "HALF", isHalfDayLeave: true, endTime: "02:00" });
        });

        it("a FULL day keeps the whole shift", () => {
          expect(schedule({ settings: applyScheduleOverride(SETTINGS, NIGHT) })).toMatchObject({ dayType: "WORKING", endTime: "06:00" });
        });
      });

      it("the same hours as company hours keep using the half-day end time", () => {
        const company = { ...SETTINGS, workStartTime: "11:00", workEndTime: "19:00" };
        expect(schedule({ workDate: SATURDAY, settings: company })).toMatchObject({ dayType: "HALF", endTime: "13:00" });
      });
    });

    describe("getLeaveKindOnDate", () => {
      const LEAVE = { startDate: "2026-11-03", endDate: "2026-11-05", startHalfDay: true, endHalfDay: false };

      it.each([
        ["the half first day", "2026-11-03", "HALF"],
        ["a middle day", "2026-11-04", "FULL"],
        ["a full last day", "2026-11-05", "FULL"],
      ])("%s", (_name, date, kind) => {
        expect(getLeaveKindOnDate(LEAVE, date)).toBe(kind);
      });

      it("the half last day", () => {
        expect(getLeaveKindOnDate({ ...LEAVE, startHalfDay: false, endHalfDay: true }, "2026-11-05")).toBe("HALF");
      });
    });

    describe("computeCorrectedRecord", () => {
      const NINE = new Date("2026-11-03T03:30:00.000Z");
      const FIVE = new Date("2026-11-03T11:30:00.000Z");
      const at = (minutesAfterNine: number) => new Date(NINE.getTime() + minutesAfterNine * 60_000);
      const base = {
        checkInAt: NINE,
        checkOutAt: null as Date | null,
        autoClosedAt: null as Date | null,
        scheduledStartAt: NINE,
        scheduledEndAt: FIVE,
        lateGraceMinutes: 10,
        flags: [] as string[],
      };

      it("an earlier check-in turns LATE into PRESENT", () => {
        expect(computeCorrectedRecord({ ...base, checkInAt: at(-5) })).toMatchObject({ status: "PRESENT", lateMinutes: 0 });
      });

      it("a later check-in turns PRESENT into LATE, counted from the start of the shift", () => {
        expect(computeCorrectedRecord({ ...base, checkInAt: at(25) })).toMatchObject({ status: "LATE", lateMinutes: 25 });
      });

      it("with no check-out, nothing is worked yet", () => {
        expect(computeCorrectedRecord(base)).toMatchObject({ workedMinutes: null, earlyLeaveMinutes: 0 });
      });

      it("a check-out gives worked and early-leave minutes", () => {
        expect(computeCorrectedRecord({ ...base, checkOutAt: at(420) })).toMatchObject({ workedMinutes: 420, earlyLeaveMinutes: 60 });
      });

      it("an auto-closed day stays INCOMPLETE until it has a check-out", () => {
        const closed = { ...base, checkInAt: at(30), autoClosedAt: at(1000), flags: ["AUTO_CLOSED"] };
        expect(computeCorrectedRecord(closed)).toMatchObject({ status: "INCOMPLETE", lateMinutes: 30 });
        expect(computeCorrectedRecord({ ...closed, checkOutAt: at(480) })).toMatchObject({ status: "LATE", workedMinutes: 450, flags: ["AUTO_CLOSED"] });
      });

      it("earns LONG_SHIFT, and loses it when the times come back", () => {
        expect(computeCorrectedRecord({ ...base, checkOutAt: at(17 * 60) }).flags).toEqual(["LONG_SHIFT"]);
        expect(computeCorrectedRecord({ ...base, checkOutAt: at(480), flags: ["LONG_SHIFT"] }).flags).toEqual([]);
      });

      it("keeps the GPS flags as captured", () => {
        expect(computeCorrectedRecord({ ...base, flags: ["LOW_ACCURACY", "OUTSIDE_RADIUS_AT_CHECKOUT"] }).flags).toEqual(["LOW_ACCURACY", "OUTSIDE_RADIUS_AT_CHECKOUT"]);
      });

      it("half-day leave is never late or early", () => {
        const half = computeCorrectedRecord({ ...base, checkInAt: at(120), checkOutAt: at(200), flags: ["HALF_DAY_LEAVE"] });
        expect(half).toMatchObject({ status: "PRESENT", lateMinutes: 0, earlyLeaveMinutes: 0 });
      });

      it("a day with no schedule is never late", () => {
        expect(computeCorrectedRecord({ ...base, scheduledStartAt: null, scheduledEndAt: null, checkInAt: at(300) })).toMatchObject({ status: "PRESENT", lateMinutes: 0 });
      });
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
