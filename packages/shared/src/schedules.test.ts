import { describe, expect, it } from "vitest";
import { SetEmployeeScheduleRequestSchema, WeekScheduleSchema } from "./schedules.js";

const WEEK = { mon: "FULL", tue: "FULL", wed: "FULL", thu: "FULL", fri: "FULL", sat: "HALF", sun: "OFF" };

describe("SetEmployeeScheduleRequestSchema", () => {
  it("accepts a night shift crossing midnight", () => {
    expect(SetEmployeeScheduleRequestSchema.safeParse({ startTime: "22:00", endTime: "06:00" }).success).toBe(true);
  });

  it.each([
    ["under an hour", "09:00", "09:30"],
    ["over 16 hours", "06:00", "23:00"],
    ["the same time, which means 24 hours", "09:00", "09:00"],
  ])("refuses a shift that's %s, on the end time", (_name, startTime, endTime) => {
    const result = SetEmployeeScheduleRequestSchema.safeParse({ startTime, endTime });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.endTime).toEqual(["A shift must be between 1 and 16 hours long"]);
  });

  it("refuses a malformed time with its own message", () => {
    const result = SetEmployeeScheduleRequestSchema.safeParse({ startTime: "9am", endTime: "17:00" });

    expect(result.error?.flatten().fieldErrors.startTime).toEqual(["Use 24-hour time, like 09:00"]);
  });

  it("limits the grace period, and null follows the company", () => {
    const base = { startTime: "09:00", endTime: "17:00" };
    expect(SetEmployeeScheduleRequestSchema.safeParse({ ...base, lateGraceMinutes: 240 }).success).toBe(true);
    expect(SetEmployeeScheduleRequestSchema.safeParse({ ...base, lateGraceMinutes: null }).success).toBe(true);
    expect(SetEmployeeScheduleRequestSchema.safeParse({ ...base, lateGraceMinutes: 241 }).success).toBe(false);
    expect(SetEmployeeScheduleRequestSchema.safeParse({ ...base, lateGraceMinutes: -1 }).success).toBe(false);
  });
});

describe("WeekScheduleSchema", () => {
  it("needs all seven days", () => {
    expect(WeekScheduleSchema.safeParse(WEEK).success).toBe(true);
    const sixDays = Object.fromEntries(Object.entries(WEEK).filter(([day]) => day !== "sun"));
    expect(WeekScheduleSchema.safeParse(sixDays).success).toBe(false);
  });

  it("refuses an unknown day or weight", () => {
    expect(WeekScheduleSchema.safeParse({ ...WEEK, funday: "FULL" }).success).toBe(false);
    expect(WeekScheduleSchema.safeParse({ ...WEEK, mon: "SOME" }).success).toBe(false);
  });
});
