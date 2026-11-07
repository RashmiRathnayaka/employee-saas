import { describe, expect, it } from "vitest";
import { DEFAULT_WORKING_DAYS_FOR_TEST, getNoCheckInDayForTest } from "./dayClose.rules.testHelpers.js";
import {
  getAutoCloseColumns,
  getAutoCloseCutoffs,
  getCatchUpDates,
  getDateCloseState,
  getNoCheckInOutcome,
  toAbsentDayVisitFlags,
  wasAttendanceOnAtStart,
} from "./dayClose.rules.js";
import { getRecordCloseTime } from "./attendance.rules.js";

const at = (iso: string) => new Date(iso);

describe("getNoCheckInOutcome", () => {
  it.each([
    ["nothing covers the day", false, null, "ABSENT", []],
    ["full-day leave", false, "FULL", "ON_LEAVE", []],
    ["half-day leave (Q8)", false, "HALF", "ON_LEAVE", ["HALF_DAY_LEAVE"]],
    ["a holiday", true, null, "HOLIDAY", []],
    ["a holiday beats leave (§1.2)", true, "FULL", "HOLIDAY", []],
    ["a holiday beats half-day leave", true, "HALF", "HOLIDAY", []],
  ] as const)("%s", (_name, isHoliday, leave, status, flags) => {
    expect(getNoCheckInOutcome({ isHoliday, leave })).toEqual({ status, flags });
  });
});

describe("getNoCheckInDay", () => {
  // 2026-03-03 is a Tuesday, the 7th a Saturday (HALF) and the 8th a Sunday (OFF).
  // Colombo is UTC+5:30. The default company hours are 09:00-17:00, with auto-checkout at 240 min.
  it("closes at the shift's end plus the auto-checkout time", () => {
    const day = getNoCheckInDayForTest({ workDate: "2026-03-03" });
    expect(day?.closeAt).toEqual(at("2026-03-03T15:30:00.000Z"));
    expect(day?.startsAt).toEqual(at("2026-03-03T03:30:00.000Z"));
  });

  it("a company half day closes from the half-day end", () => {
    expect(getNoCheckInDayForTest({ workDate: "2026-03-07" })?.closeAt).toEqual(at("2026-03-07T11:30:00.000Z"));
  });

  it("a weekly off day has none", () => {
    expect(getNoCheckInDayForTest({ workDate: "2026-03-08" })).toBeNull();
  });

  it("a holiday on a weekly off day has none: it's still an off day", () => {
    expect(getNoCheckInDayForTest({ workDate: "2026-03-08", isHoliday: true })).toBeNull();
  });

  it("a holiday on a working day waits for midnight, company time, since anyone may still check in", () => {
    const day = getNoCheckInDayForTest({ workDate: "2026-03-03", isHoliday: true });
    expect(day?.closeAt).toEqual(at("2026-03-03T18:30:00.000Z"));
    expect(day?.schedule.scheduledEndAt).toBeNull();
  });

  it("a night-shift override closes the next day, not at midnight", () => {
    const day = getNoCheckInDayForTest({ workDate: "2026-03-03", settings: { workStartTime: "22:00", workEndTime: "06:00", isOverride: true } });
    expect(day?.closeAt).toEqual(at("2026-03-04T04:30:00.000Z"));
  });

  it("an override's half day is the first half of its own shift, from the same rule as a check-in", () => {
    const day = getNoCheckInDayForTest({ workDate: "2026-03-07", settings: { workStartTime: "22:00", workEndTime: "06:00", isOverride: true } });
    // Ends 02:00 on the 8th, plus 4 hours.
    expect(day?.closeAt).toEqual(at("2026-03-08T00:30:00.000Z"));
  });

  it("an override with its own week can work a company off day", () => {
    const day = getNoCheckInDayForTest({ workDate: "2026-03-08", settings: { workingDays: { ...DEFAULT_WORKING_DAYS_FOR_TEST, sun: "FULL" }, isOverride: true } });
    expect(day).not.toBeNull();
  });

  it("uses the company's timezone", () => {
    const day = getNoCheckInDayForTest({ workDate: "2026-03-03", timezone: "America/New_York" });
    expect(day?.closeAt).toEqual(at("2026-03-04T02:00:00.000Z"));
  });

  it("counts the auto-checkout time across a clock change", () => {
    // London's clocks went forward on 29 March 2026: 17:00 BST is 16:00 UTC.
    const day = getNoCheckInDayForTest({
      workDate: "2026-03-29",
      timezone: "Europe/London",
      settings: { workingDays: { ...DEFAULT_WORKING_DAYS_FOR_TEST, sun: "FULL" } },
    });
    expect(day?.closeAt).toEqual(at("2026-03-29T20:00:00.000Z"));
  });
});

describe("wasAttendanceOnAtStart", () => {
  const start = at("2026-03-03T03:30:00.000Z");
  it("on before the shift started: counts", () => expect(wasAttendanceOnAtStart(at("2026-03-02T00:00:00.000Z"), start)).toBe(true));
  it("on exactly when it started: counts", () => expect(wasAttendanceOnAtStart(start, start)).toBe(true));
  it("on after it started: doesn't, they may not have been able to check in", () => {
    expect(wasAttendanceOnAtStart(at("2026-03-03T03:30:01.000Z"), start)).toBe(false);
  });
  it("never recorded: doesn't", () => expect(wasAttendanceOnAtStart(null, start)).toBe(false));
});

describe("getCatchUpDates", () => {
  it("is the last two dates and today, oldest first", () => {
    expect(getCatchUpDates("2026-03-01")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });
});

describe("getDateCloseState", () => {
  const now = at("2026-03-03T12:00:00.000Z");
  it.each([
    ["nobody works that date", [], null],
    ["nobody's time has come", ["2026-03-03T12:00:01.000Z"], "WAITING"],
    ["some have", ["2026-03-03T12:00:00.000Z", "2026-03-03T12:00:01.000Z"], "PARTLY_CLOSED"],
    ["all have, at exactly the moment", ["2026-03-03T11:00:00.000Z", "2026-03-03T12:00:00.000Z"], "FINISHED"],
  ] as const)("%s", (_name, times, state) => {
    expect(getDateCloseState(times.map(at), now)).toBe(state);
  });
});

describe("getAutoCloseColumns", () => {
  it("adds the flag once and keeps the others", () => {
    const now = at("2026-03-03T12:00:00.000Z");
    expect(getAutoCloseColumns(["LOW_ACCURACY"], now)).toEqual({ status: "INCOMPLETE", autoClosedAt: now, flags: ["LOW_ACCURACY", "AUTO_CLOSED"] });
    expect(getAutoCloseColumns(["AUTO_CLOSED"], now).flags).toEqual(["AUTO_CLOSED"]);
  });
});

describe("getAutoCloseCutoffs", () => {
  it("finds exactly the rows getRecordCloseTime says have closed", () => {
    const now = at("2026-03-03T12:00:00.000Z");
    const { scheduledEndAtOrBefore, noScheduleCheckInAtOrBefore } = getAutoCloseCutoffs(now, 240);

    expect(getRecordCloseTime({ scheduledEndAt: scheduledEndAtOrBefore, checkInAt: null }, 240)).toEqual(now);
    expect(getRecordCloseTime({ scheduledEndAt: null, checkInAt: noScheduleCheckInAtOrBefore }, 240)).toEqual(now);
  });
});

describe("toAbsentDayVisitFlags", () => {
  it("replaces AFTER_HOURS, keeps GPS flags, and doesn't double up", () => {
    expect(toAbsentDayVisitFlags(["AFTER_HOURS", "LOW_ACCURACY"])).toEqual(["LOW_ACCURACY", "ON_ABSENT_DAY"]);
    expect(toAbsentDayVisitFlags(["ON_ABSENT_DAY"])).toEqual(["ON_ABSENT_DAY"]);
    expect(toAbsentDayVisitFlags([])).toEqual(["ON_ABSENT_DAY"]);
  });
});
