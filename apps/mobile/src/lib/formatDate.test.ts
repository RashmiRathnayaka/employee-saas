import { describe, expect, it } from "@jest/globals";
import { addDaysToIsoDate, toLocalIsoDate } from "./formatDate";

describe("toLocalIsoDate", () => {
  it("formats using the Date's local calendar fields, not toISOString's UTC conversion", () => {
    // A local midnight picked in a timezone ahead of UTC (e.g. Asia/Colombo,
    // UTC+5:30) is the exact bug this guards against: date.toISOString()
    // would roll this back to the previous day.
    const date = new Date(2026, 10, 15, 0, 0, 0); // months are 0-indexed: Nov 15
    expect(toLocalIsoDate(date)).toBe("2026-11-15");
  });

  it("pads single-digit months and days", () => {
    const date = new Date(2026, 0, 5, 0, 0, 0); // Jan 5
    expect(toLocalIsoDate(date)).toBe("2026-01-05");
  });
});

describe("addDaysToIsoDate", () => {
  it("subtracts days across a month boundary", () => {
    expect(addDaysToIsoDate("2026-11-05", -30)).toBe("2026-10-06");
  });

  it("adds days across a year boundary", () => {
    expect(addDaysToIsoDate("2026-12-20", 30)).toBe("2027-01-19");
  });

  it("is a no-op for 0 days", () => {
    expect(addDaysToIsoDate("2026-11-01", 0)).toBe("2026-11-01");
  });
});
