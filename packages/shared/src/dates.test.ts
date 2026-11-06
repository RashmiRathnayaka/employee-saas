import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDaysToIsoDate,
  currentYearInTimezone,
  daysBetweenIsoDates,
  formatDate,
  formatDateTime,
  formatDuration,
  formatTime,
  isoDateToLocalDate,
  isoDateToUtcDate,
  todayInTimezone,
  toLocalIsoDate,
  utcDateToIsoDate,
} from "./dates.js";
import { getProcessTimezone, setProcessTimezone, TEST_TIMEZONES } from "./testing/timezone.js";

// 00:15 on 6 Jan 2026 in Colombo is 18:45 on 5 Jan in UTC - the exact
// window where "today" computed the wrong way lands on the previous day.
const JUST_AFTER_COLOMBO_MIDNIGHT = new Date("2026-01-05T18:45:00.000Z");

describe.each(TEST_TIMEZONES)("date helpers with process TZ=$tz", ({ tz, offsetMinutes }) => {
  let previousTz: string | undefined;

  beforeAll(() => {
    previousTz = getProcessTimezone();
    setProcessTimezone(tz);
  });
  afterAll(() => setProcessTimezone(previousTz));

  it("actually runs in the requested timezone", () => {
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(offsetMinutes);
  });

  describe("a date picked at local midnight", () => {
    it("toLocalIsoDate keeps the tapped day (toISOString would not, east of UTC)", () => {
      const picked = new Date(2026, 10, 15, 0, 0, 0); // what a native picker returns for 15 Nov
      expect(toLocalIsoDate(picked)).toBe("2026-11-15");
    });

    it("round-trips through isoDateToLocalDate", () => {
      expect(toLocalIsoDate(isoDateToLocalDate("2026-01-01"))).toBe("2026-01-01");
      expect(toLocalIsoDate(isoDateToLocalDate("2026-12-31"))).toBe("2026-12-31");
    });

    it("pads single-digit months and days", () => {
      expect(toLocalIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    });
  });

  describe("today just after local midnight in Colombo", () => {
    it("is the Colombo date, regardless of the process timezone", () => {
      expect(todayInTimezone("Asia/Colombo", JUST_AFTER_COLOMBO_MIDNIGHT)).toBe("2026-01-06");
      expect(todayInTimezone("UTC", JUST_AFTER_COLOMBO_MIDNIGHT)).toBe("2026-01-05");
    });

    it("rolls the year over on 1 Jan at 00:15 Colombo", () => {
      const newYear = new Date("2025-12-31T18:45:00.000Z");
      expect(currentYearInTimezone("Asia/Colombo", newYear)).toBe(2026);
      expect(currentYearInTimezone("UTC", newYear)).toBe(2025);
    });
  });

  describe("calendar-date arithmetic", () => {
    it("isoDateToUtcDate / utcDateToIsoDate round-trip (Prisma @db.Date shape)", () => {
      const d = isoDateToUtcDate("2026-03-01");
      expect(d.toISOString()).toBe("2026-03-01T00:00:00.000Z");
      expect(utcDateToIsoDate(d)).toBe("2026-03-01");
    });

    it("adds/subtracts days across month, year and leap-day boundaries", () => {
      expect(addDaysToIsoDate("2026-11-05", -30)).toBe("2026-10-06");
      expect(addDaysToIsoDate("2026-12-20", 30)).toBe("2027-01-19");
      expect(addDaysToIsoDate("2028-02-28", 1)).toBe("2028-02-29");
      expect(addDaysToIsoDate("2026-11-01", 0)).toBe("2026-11-01");
    });

    it("counts days between dates", () => {
      expect(daysBetweenIsoDates("2026-01-06", "2026-01-06")).toBe(0);
      expect(daysBetweenIsoDates("2025-12-27", "2026-01-06")).toBe(10);
      expect(daysBetweenIsoDates("2026-01-06", "2026-01-05")).toBe(-1);
    });

    it("rejects a non YYYY-MM-DD input", () => {
      expect(() => isoDateToUtcDate("2026-1-5")).toThrow();
    });
  });

  describe("formatting", () => {
    it("shows a calendar date as exactly that day in any timezone", () => {
      expect(formatDate("2026-01-06", "Asia/Colombo")).toBe("06 Jan 2026");
      expect(formatDate("2026-01-06", "America/New_York")).toBe("06 Jan 2026");
    });

    it("shows a timestamp as its day in the given timezone", () => {
      expect(formatDate(JUST_AFTER_COLOMBO_MIDNIGHT.toISOString(), "Asia/Colombo")).toBe("06 Jan 2026");
      expect(formatDate(JUST_AFTER_COLOMBO_MIDNIGHT.toISOString(), "UTC")).toBe("05 Jan 2026");
    });

    it("formats a time in the given timezone", () => {
      expect(formatTime(JUST_AFTER_COLOMBO_MIDNIGHT.toISOString(), "Asia/Colombo")).toBe("00:15");
      expect(formatTime(JUST_AFTER_COLOMBO_MIDNIGHT.toISOString(), "UTC")).toBe("18:45");
    });

    it("formats date + time in the given timezone", () => {
      expect(formatDateTime(JUST_AFTER_COLOMBO_MIDNIGHT.toISOString(), "Asia/Colombo")).toBe("06 Jan 2026, 00:15");
    });
  });

  describe("formatDuration", () => {
    it.each([
      [0, "0m"],
      [45, "45m"],
      [60, "1h"],
      [483, "8h 3m"],
      [1020, "17h"],
    ])("%i minutes is %s", (minutes, text) => {
      expect(formatDuration(minutes)).toBe(text);
    });
  });
});
