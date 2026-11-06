import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getShiftInstants, getWorkDate, zonedDateTimeToUtc } from "./dates.js";
import { getProcessTimezone, setProcessTimezone } from "./testing/timezone.js";

/** The process timezone must make no difference, so everything below runs
 * under each of these. The offsets are for a date in July: in January London
 * has the same offset as UTC, and a silently-ignored TZ would go unnoticed. */
const PROCESS_TIMEZONES = [
  { tz: "Asia/Colombo", offsetMinutes: -330 },
  { tz: "UTC", offsetMinutes: 0 },
  { tz: "Europe/London", offsetMinutes: -60 },
] as const;

const NIGHT_SHIFT = { startTime: "22:00", endTime: "06:00" };
const DAY_SHIFT = { startTime: "09:00", endTime: "17:00" };

describe.each(PROCESS_TIMEZONES)("zoned time helpers with process TZ=$tz", ({ tz, offsetMinutes }) => {
  let previousTz: string | undefined;

  beforeAll(() => {
    previousTz = getProcessTimezone();
    setProcessTimezone(tz);
  });
  afterAll(() => setProcessTimezone(previousTz));

  it("actually runs in the requested timezone", () => {
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(offsetMinutes);
  });

  describe("zonedDateTimeToUtc", () => {
    it.each([
      // Fixed-offset zones
      ["Asia/Colombo", "2026-11-03", "09:00", "2026-11-03T03:30:00.000Z"],
      ["Asia/Colombo", "2026-11-03", "22:00", "2026-11-03T16:30:00.000Z"],
      ["Asia/Colombo", "2026-01-01", "00:15", "2025-12-31T18:45:00.000Z"], // previous UTC day and year
      ["Asia/Kathmandu", "2026-11-03", "09:00", "2026-11-03T03:15:00.000Z"], // +05:45
      ["UTC", "2026-11-03", "09:00", "2026-11-03T09:00:00.000Z"],
      ["America/Los_Angeles", "2026-11-03", "22:00", "2026-11-04T06:00:00.000Z"], // next UTC day
      // London, ordinary days either side of daylight saving
      ["Europe/London", "2026-01-15", "09:00", "2026-01-15T09:00:00.000Z"],
      ["Europe/London", "2026-07-15", "09:00", "2026-07-15T08:00:00.000Z"],
    ])("%s %s %s -> %s", (zone, date, time, expected) => {
      expect(zonedDateTimeToUtc(date, time, zone).toISOString()).toBe(expected);
    });

    // 29 Mar 2026: at 01:00 GMT, London's clocks jump to 02:00 BST.
    it.each([
      ["00:59", "2026-03-29T00:59:00.000Z"], // last minute before the jump
      ["01:00", "2026-03-29T01:00:00.000Z"], // doesn't exist -> 02:00 BST
      ["01:30", "2026-03-29T01:30:00.000Z"], // doesn't exist -> 02:30 BST
      ["02:00", "2026-03-29T01:00:00.000Z"], // first real BST time
      ["09:00", "2026-03-29T08:00:00.000Z"],
    ])("London spring change: %s -> %s", (time, expected) => {
      expect(zonedDateTimeToUtc("2026-03-29", time, "Europe/London").toISOString()).toBe(expected);
    });

    // 25 Oct 2026: at 02:00 BST, London's clocks go back to 01:00 GMT, so
    // 01:00-01:59 happens twice.
    it.each([
      ["00:30", "2026-10-24T23:30:00.000Z"],
      ["01:00", "2026-10-25T00:00:00.000Z"], // the first 01:00 (BST)
      ["01:30", "2026-10-25T00:30:00.000Z"], // the first 01:30 (BST)
      ["02:00", "2026-10-25T02:00:00.000Z"],
      ["09:00", "2026-10-25T09:00:00.000Z"],
    ])("London autumn change: %s -> %s", (time, expected) => {
      expect(zonedDateTimeToUtc("2026-10-25", time, "Europe/London").toISOString()).toBe(expected);
    });

    it("handles a negative-offset zone's jump too (New York, 8 Mar 2026)", () => {
      expect(zonedDateTimeToUtc("2026-03-08", "02:30", "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
    });

    it("round-trips: the result shows the same wall clock in that zone", () => {
      const show = (date: Date, zone: string) =>
        new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);

      for (const zone of ["Asia/Colombo", "Europe/London", "America/New_York"]) {
        // The London autumn change day: every time exists, some of them twice.
        for (let hour = 0; hour < 24; hour++) {
          const time = `${String(hour).padStart(2, "0")}:30`;
          expect(show(zonedDateTimeToUtc("2026-10-25", time, zone), zone)).toBe(time);
        }
      }
    });

    it.each([
      ["2026-02-30", "09:00", "Asia/Colombo"], // impossible date
      ["2026-13-01", "09:00", "Asia/Colombo"], // impossible month
      ["03/11/2026", "09:00", "Asia/Colombo"], // wrong date format
      ["2026-11-03", "24:00", "Asia/Colombo"], // impossible time
      ["2026-11-03", "9:00", "Asia/Colombo"], // not zero-padded
      ["2026-11-03", "09:00", "Not/AZone"], // unknown zone
    ])("throws on bad input: %s %s %s", (date, time, zone) => {
      expect(() => zonedDateTimeToUtc(date, time, zone)).toThrow();
    });
  });

  describe("getShiftInstants", () => {
    it("keeps a day shift on the same date", () => {
      const shift = getShiftInstants({ workDate: "2026-11-03", ...DAY_SHIFT, timezone: "Asia/Colombo" });
      expect(shift.scheduledStartAt.toISOString()).toBe("2026-11-03T03:30:00.000Z");
      expect(shift.scheduledEndAt.toISOString()).toBe("2026-11-03T11:30:00.000Z");
    });

    it("ends a night shift on the next date", () => {
      const shift = getShiftInstants({ workDate: "2026-11-03", ...NIGHT_SHIFT, timezone: "Asia/Colombo" });
      expect(shift.scheduledStartAt.toISOString()).toBe("2026-11-03T16:30:00.000Z");
      expect(shift.scheduledEndAt.toISOString()).toBe("2026-11-04T00:30:00.000Z");
    });

    it("treats an end time equal to the start as the next day", () => {
      const shift = getShiftInstants({ workDate: "2026-11-03", startTime: "09:00", endTime: "09:00", timezone: "UTC" });
      expect(shift.scheduledEndAt.toISOString()).toBe("2026-11-04T09:00:00.000Z");
    });

    it("gives a night shift its real length across a clock change", () => {
      const hours = (workDate: string) => {
        const shift = getShiftInstants({ workDate, ...NIGHT_SHIFT, timezone: "Europe/London" });
        return (shift.scheduledEndAt.getTime() - shift.scheduledStartAt.getTime()) / 3_600_000;
      };
      expect(hours("2026-03-28")).toBe(7); // an hour is lost overnight
      expect(hours("2026-10-24")).toBe(9); // an hour is gained overnight
      expect(hours("2026-07-15")).toBe(8);
    });
  });

  describe("getWorkDate", () => {
    it.each([
      // Night shift 22:00-06:00 in Colombo (+05:30)
      ["23:50 on the 3rd: tonight's shift", "2026-11-03T18:20:00.000Z", NIGHT_SHIFT, "2026-11-03"],
      ["00:20 on the 4th: still the 3rd's shift", "2026-11-03T18:50:00.000Z", NIGHT_SHIFT, "2026-11-03"],
      ["05:59 on the 4th: still the 3rd's shift", "2026-11-04T00:29:00.000Z", NIGHT_SHIFT, "2026-11-03"],
      ["06:00 on the 4th: the shift has ended", "2026-11-04T00:30:00.000Z", NIGHT_SHIFT, "2026-11-04"],
      ["06:01 on the 4th", "2026-11-04T00:31:00.000Z", NIGHT_SHIFT, "2026-11-04"],
      ["21:30 on the 3rd: an early bird for tonight", "2026-11-03T16:00:00.000Z", NIGHT_SHIFT, "2026-11-03"],
      // Day shift: always the local date, including just after midnight
      ["00:20 with a day shift yesterday", "2026-11-03T18:50:00.000Z", DAY_SHIFT, "2026-11-04"],
      ["09:05 with a day shift yesterday", "2026-11-04T03:35:00.000Z", DAY_SHIFT, "2026-11-04"],
      ["03:00, far earlier than any start", "2026-11-03T21:30:00.000Z", DAY_SHIFT, "2026-11-04"],
      // Yesterday was off or a holiday: no shift can still be running
      ["00:20 with yesterday off", "2026-11-03T18:50:00.000Z", null, "2026-11-04"],
    ])("Colombo: %s", (_label, now, previousDaySchedule, expected) => {
      expect(getWorkDate({ now: new Date(now), timezone: "Asia/Colombo", previousDaySchedule })).toBe(expected);
    });

    it("uses the company's date, not UTC's: 00:15 local is yesterday in UTC", () => {
      const now = new Date("2026-01-05T18:45:00.000Z");
      expect(getWorkDate({ now, timezone: "Asia/Colombo", previousDaySchedule: DAY_SHIFT })).toBe("2026-01-06");
    });

    it("treats a shift ending exactly at midnight as over at midnight", () => {
      const untilMidnight = { startTime: "16:00", endTime: "00:00" };
      // 23:59 on the 3rd, then 00:00 on the 4th, Colombo time.
      expect(getWorkDate({ now: new Date("2026-11-03T18:29:00.000Z"), timezone: "Asia/Colombo", previousDaySchedule: untilMidnight })).toBe("2026-11-03");
      expect(getWorkDate({ now: new Date("2026-11-03T18:30:00.000Z"), timezone: "Asia/Colombo", previousDaySchedule: untilMidnight })).toBe("2026-11-04");
    });

    it.each([
      // Spring: the 28 Mar night ends at 06:00 BST, which is 05:00Z.
      ["spring, 05:59 BST", "2026-03-29T04:59:00.000Z", "2026-03-28"],
      ["spring, 06:00 BST", "2026-03-29T05:00:00.000Z", "2026-03-29"],
      // Autumn: the 24 Oct night ends at 06:00 GMT, which is 06:00Z.
      ["autumn, 05:59 GMT", "2026-10-25T05:59:00.000Z", "2026-10-24"],
      ["autumn, 06:00 GMT", "2026-10-25T06:00:00.000Z", "2026-10-25"],
      // Autumn: the repeated hour, both times round, is still the same shift.
      ["autumn, first 01:30", "2026-10-25T00:30:00.000Z", "2026-10-24"],
      ["autumn, second 01:30", "2026-10-25T01:30:00.000Z", "2026-10-24"],
    ])("London night shift over a clock change: %s", (_label, now, expected) => {
      expect(getWorkDate({ now: new Date(now), timezone: "Europe/London", previousDaySchedule: NIGHT_SHIFT })).toBe(expected);
    });
  });
});
