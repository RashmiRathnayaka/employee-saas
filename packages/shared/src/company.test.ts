import { describe, expect, it } from "vitest";
import {
  isModuleEnabled,
  isValidShiftLength,
  SHIFT_LENGTH_MESSAGE,
  UpdateCompanySettingsRequestSchema,
} from "./company.js";

describe("isModuleEnabled", () => {
  it("is true only for a literal true", () => {
    expect(isModuleEnabled({ enabledModules: { attendance: true } }, "attendance")).toBe(true);
    expect(isModuleEnabled({ enabledModules: { attendance: false } }, "attendance")).toBe(false);
    expect(isModuleEnabled({ enabledModules: { attendance: "true" } }, "attendance")).toBe(false);
    expect(isModuleEnabled({ enabledModules: { attendance: 1 } }, "attendance")).toBe(false);
  });

  it("denies by default: missing key, empty object, missing settings, malformed value", () => {
    expect(isModuleEnabled({ enabledModules: { sites: true } }, "attendance")).toBe(false);
    expect(isModuleEnabled({ enabledModules: {} }, "attendance")).toBe(false);
    expect(isModuleEnabled({}, "attendance")).toBe(false);
    expect(isModuleEnabled(null, "attendance")).toBe(false);
    expect(isModuleEnabled(undefined, "attendance")).toBe(false);
    expect(isModuleEnabled({ enabledModules: null }, "attendance")).toBe(false);
    expect(isModuleEnabled({ enabledModules: "attendance" }, "attendance")).toBe(false);
  });
});

describe("UpdateCompanySettingsRequestSchema", () => {
  const parse = (value: unknown) => UpdateCompanySettingsRequestSchema.safeParse(value).success;

  it.each(["00:00", "09:00", " 09:00 ", "23:59"])("accepts the time %j", (time) => {
    expect(parse({ workStartTime: time })).toBe(true);
  });

  it.each(["24:00", "9:00", "09:60", "09:00:00", "", "morning"])("rejects the time %j", (time) => {
    expect(parse({ workStartTime: time })).toBe(false);
    expect(parse({ workEndTime: time })).toBe(false);
    expect(parse({ halfDayEndTime: time })).toBe(false);
    expect(parse({ dailyReminderTime: time })).toBe(false);
  });

  it.each([
    ["lateGraceMinutes", 0, 240],
    ["autoCheckoutAfterMinutes", 30, 720],
    ["checkinReminderOffsetMinutes", 0, 120],
    ["gpsMaxAccuracyMeters", 10, 1000],
    ["gpsRetentionDays", 30, 365],
  ])("enforces the range of %s (%i to %i)", (field, min, max) => {
    expect(parse({ [field]: min })).toBe(true);
    expect(parse({ [field]: max })).toBe(true);
    expect(parse({ [field]: min - 1 })).toBe(false);
    expect(parse({ [field]: max + 1 })).toBe(false);
    expect(parse({ [field]: min + 0.5 })).toBe(false);
    expect(parse({ [field]: Number.NaN })).toBe(false);
  });

  it("gives gpsRadiusMeters the same 25-5000 range as a site", () => {
    expect(parse({ gpsRadiusMeters: 25 })).toBe(true);
    expect(parse({ gpsRadiusMeters: 5000 })).toBe(true);
    expect(parse({ gpsRadiusMeters: 0 })).toBe(false);
    expect(parse({ gpsRadiusMeters: 24 })).toBe(false);
    expect(parse({ gpsRadiusMeters: 5001 })).toBe(false);
    expect(parse({ gpsRadiusMeters: 100.5 })).toBe(false);
  });

  it.each([
    ["09:00", "17:00"],
    ["09:00", "10:00"], // exactly 1 hour
    ["06:00", "22:00"], // exactly 16 hours
    ["22:00", "06:00"], // crosses midnight
    ["23:30", "00:30"], // crosses midnight, exactly 1 hour
    ["16:00", "08:00"], // crosses midnight, exactly 16 hours
  ])("accepts the shift %s to %s", (workStartTime, workEndTime) => {
    expect(isValidShiftLength(workStartTime, workEndTime)).toBe(true);
    expect(parse({ workStartTime, workEndTime })).toBe(true);
  });

  it.each([
    ["09:00", "09:00"], // the same time means the next day: 24 hours
    ["09:00", "09:59"], // 59 minutes
    ["09:00", "08:00"], // 23 hours
    ["06:00", "22:01"], // 16 hours 1 minute
    ["16:00", "08:01"], // crosses midnight, 16 hours 1 minute
    ["23:30", "00:29"], // crosses midnight, 59 minutes
  ])("rejects the shift %s to %s, on the end time", (workStartTime, workEndTime) => {
    expect(isValidShiftLength(workStartTime, workEndTime)).toBe(false);
    const result = UpdateCompanySettingsRequestSchema.safeParse({ workStartTime, workEndTime });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.workEndTime).toEqual([SHIFT_LENGTH_MESSAGE]);
    }
  });

  it("leaves a single shift time for the API to check against the stored one", () => {
    expect(parse({ workStartTime: "09:00" })).toBe(true);
    expect(parse({ workEndTime: "09:00" })).toBe(true);
  });

  it("reports a malformed time as a format error, not a shift length error", () => {
    const result = UpdateCompanySettingsRequestSchema.safeParse({ workStartTime: "", workEndTime: "17:00" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.workEndTime).toBeUndefined();
      expect(result.error.flatten().fieldErrors.workStartTime).toBeDefined();
    }
  });

  it("accepts known module keys, in any combination", () => {
    expect(parse({ enabledModules: { attendance: true } })).toBe(true);
    expect(parse({ enabledModules: { attendance: true, sites: false, tasks: true } })).toBe(true);
  });

  it("rejects an unknown module key and a non-boolean value", () => {
    expect(parse({ enabledModules: { payroll: true } })).toBe(false);
    expect(parse({ enabledModules: { attendance: "yes" } })).toBe(false);
  });
});
