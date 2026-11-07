import { describe, expect, it } from "vitest";
import { getDueDailyKeys, REMINDER_CATCH_UP_MS } from "./schedule.js";

// Colombo is UTC+5:30 all year, so 09:00 there is 03:30 UTC.
function due(nowIso: string, time = "09:00", timezone = "Asia/Colombo", catchUpMs = REMINDER_CATCH_UP_MS) {
  return getDueDailyKeys({ now: new Date(nowIso), timezone, time, catchUpMs });
}

describe("getDueDailyKeys", () => {
  it("is not due a second before the time, and is due at it", () => {
    expect(due("2026-03-03T03:29:59.000Z")).toEqual([]);
    expect(due("2026-03-03T03:30:00.000Z")).toEqual(["2026-03-03"]);
  });

  it("stays due for the catch-up window, then skips the date", () => {
    expect(due("2026-03-03T05:29:59.000Z")).toEqual(["2026-03-03"]);
    expect(due("2026-03-03T05:30:00.000Z")).toEqual([]);
  });

  it("uses the company's date, not UTC's: 00:10 in Colombo is still the day before in UTC", () => {
    // 2026-03-03 00:10 Colombo is 2026-03-02 18:40 UTC.
    expect(due("2026-03-02T18:40:00.000Z", "00:05")).toEqual(["2026-03-03"]);
  });

  it("a late-evening time is still found just after midnight, under yesterday's date", () => {
    // 23:30 on 3 Mar in Colombo is 18:00 UTC; 00:10 on 4 Mar is 18:40 UTC.
    expect(due("2026-03-03T18:40:00.000Z", "23:30")).toEqual(["2026-03-03"]);
  });

  it("can return two dates when the window is longer than a day's gap", () => {
    expect(due("2026-03-03T04:00:00.000Z", "09:00", "Asia/Colombo", 48 * 60 * 60_000)).toEqual(["2026-03-02", "2026-03-03"]);
  });

  it("works in UTC for platform-wide jobs", () => {
    expect(due("2026-03-03T04:00:00.000Z", "04:00", "UTC")).toEqual(["2026-03-03"]);
    expect(due("2026-03-03T03:59:00.000Z", "04:00", "UTC")).toEqual([]);
  });
});
