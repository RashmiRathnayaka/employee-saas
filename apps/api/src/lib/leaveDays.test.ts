import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateLeaveDays, getTodayInTimezone, normalizeWorkingDays, type WorkingDaysConfig } from "./leaveDays.js";

const STANDARD_WEEK: WorkingDaysConfig = {
  mon: "FULL",
  tue: "FULL",
  wed: "FULL",
  thu: "FULL",
  fri: "FULL",
  sat: "HALF",
  sun: "OFF",
};

function d(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

describe("calculateLeaveDays", () => {
  it("counts a single full weekday as 1 day", () => {
    // Monday 2026-01-05
    const total = calculateLeaveDays({
      startDate: d("2026-01-05"),
      endDate: d("2026-01-05"),
      startHalfDay: false,
      endHalfDay: false,
      workingDays: STANDARD_WEEK,
      holidays: new Set(),
    });
    expect(total).toBe(1);
  });

  it("counts a 5-day working week (Mon-Fri) as 5 days", () => {
    const total = calculateLeaveDays({
      startDate: d("2026-01-05"), // Mon
      endDate: d("2026-01-09"), // Fri
      startHalfDay: false,
      endHalfDay: false,
      workingDays: STANDARD_WEEK,
      holidays: new Set(),
    });
    expect(total).toBe(5);
  });

  it("counts Saturday as a half day and Sunday as not counted", () => {
    const total = calculateLeaveDays({
      startDate: d("2026-01-10"), // Sat
      endDate: d("2026-01-11"), // Sun
      startHalfDay: false,
      endHalfDay: false,
      workingDays: STANDARD_WEEK,
      holidays: new Set(),
    });
    expect(total).toBe(0.5);
  });

  it("crosses a weekend correctly (Fri -> Mon)", () => {
    const total = calculateLeaveDays({
      startDate: d("2026-01-09"), // Fri
      endDate: d("2026-01-12"), // Mon
      startHalfDay: false,
      endHalfDay: false,
      workingDays: STANDARD_WEEK,
      holidays: new Set(),
    });
    // Fri 1 + Sat 0.5 + Sun 0 + Mon 1 = 2.5
    expect(total).toBe(2.5);
  });

  it("a holiday on a weekday removes that day entirely, overriding workingDays", () => {
    const total = calculateLeaveDays({
      startDate: d("2026-01-05"), // Mon
      endDate: d("2026-01-09"), // Fri
      startHalfDay: false,
      endHalfDay: false,
      workingDays: STANDARD_WEEK,
      holidays: new Set(["2026-01-07"]), // Wed
    });
    expect(total).toBe(4);
  });

  it("applies startHalfDay to only the first day", () => {
    const total = calculateLeaveDays({
      startDate: d("2026-01-05"), // Mon
      endDate: d("2026-01-06"), // Tue
      startHalfDay: true,
      endHalfDay: false,
      workingDays: STANDARD_WEEK,
      holidays: new Set(),
    });
    expect(total).toBe(1.5);
  });

  it("applies endHalfDay to only the last day", () => {
    const total = calculateLeaveDays({
      startDate: d("2026-01-05"), // Mon
      endDate: d("2026-01-06"), // Tue
      startHalfDay: false,
      endHalfDay: true,
      workingDays: STANDARD_WEEK,
      holidays: new Set(),
    });
    expect(total).toBe(1.5);
  });

  it("a single-day request with one half-day flag is 0.5", () => {
    const total = calculateLeaveDays({
      startDate: d("2026-01-05"),
      endDate: d("2026-01-05"),
      startHalfDay: true,
      endHalfDay: false,
      workingDays: STANDARD_WEEK,
      holidays: new Set(),
    });
    expect(total).toBe(0.5);
  });

  it("rejects a single-day request with both half-day flags set", () => {
    expect(() =>
      calculateLeaveDays({
        startDate: d("2026-01-05"),
        endDate: d("2026-01-05"),
        startHalfDay: true,
        endHalfDay: true,
        workingDays: STANDARD_WEEK,
        holidays: new Set(),
      }),
    ).toThrowError(/half-day/i);
  });

  it("rejects endDate before startDate", () => {
    expect(() =>
      calculateLeaveDays({
        startDate: d("2026-01-09"),
        endDate: d("2026-01-05"),
        startHalfDay: false,
        endHalfDay: false,
        workingDays: STANDARD_WEEK,
        holidays: new Set(),
      }),
    ).toThrowError(/endDate/i);
  });

  it("rejects a range that works out to 0 days (e.g. a single Sunday)", () => {
    expect(() =>
      calculateLeaveDays({
        startDate: d("2026-01-11"), // Sun
        endDate: d("2026-01-11"),
        startHalfDay: false,
        endHalfDay: false,
        workingDays: STANDARD_WEEK,
        holidays: new Set(),
      }),
    ).toThrowError(/greater than 0/i);
  });

  it("rejects a range that is entirely a holiday", () => {
    expect(() =>
      calculateLeaveDays({
        startDate: d("2026-01-05"),
        endDate: d("2026-01-05"),
        startHalfDay: false,
        endHalfDay: false,
        workingDays: STANDARD_WEEK,
        holidays: new Set(["2026-01-05"]),
      }),
    ).toThrowError(/greater than 0/i);
  });

  it("a company with no half-Saturday (Sat=OFF) counts a Fri-Mon span as 2 days", () => {
    const total = calculateLeaveDays({
      startDate: d("2026-01-09"),
      endDate: d("2026-01-12"),
      startHalfDay: false,
      endHalfDay: false,
      workingDays: { ...STANDARD_WEEK, sat: "OFF" },
      holidays: new Set(),
    });
    expect(total).toBe(2);
  });
});

describe("normalizeWorkingDays", () => {
  it("returns the standard default when given garbage", () => {
    expect(normalizeWorkingDays(null)).toEqual(STANDARD_WEEK);
    expect(normalizeWorkingDays("not an object")).toEqual(STANDARD_WEEK);
    expect(normalizeWorkingDays(undefined)).toEqual(STANDARD_WEEK);
  });

  it("fills in missing or invalid days with the default, keeping valid overrides", () => {
    expect(normalizeWorkingDays({ sat: "OFF", wed: "not-a-weight" })).toEqual({ ...STANDARD_WEEK, sat: "OFF" });
  });
});

describe("getTodayInTimezone", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a YYYY-MM-DD string", () => {
    const today = getTodayInTimezone("Asia/Colombo");
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reflects the local date, not the UTC date, near a day boundary", () => {
    // 2026-01-05T23:00:00Z is already 2026-01-06 04:30 in Asia/Colombo (UTC+5:30)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T23:00:00.000Z"));

    expect(getTodayInTimezone("Asia/Colombo")).toBe("2026-01-06");
    expect(getTodayInTimezone("UTC")).toBe("2026-01-05");
  });
});
