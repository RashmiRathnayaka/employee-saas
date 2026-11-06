import { describe, expect, it } from "vitest";
import { isModuleEnabled, UpdateCompanySettingsRequestSchema } from "./company.js";

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

  it("accepts known module keys, in any combination", () => {
    expect(parse({ enabledModules: { attendance: true } })).toBe(true);
    expect(parse({ enabledModules: { attendance: true, sites: false, tasks: true } })).toBe(true);
  });

  it("rejects an unknown module key and a non-boolean value", () => {
    expect(parse({ enabledModules: { payroll: true } })).toBe(false);
    expect(parse({ enabledModules: { attendance: "yes" } })).toBe(false);
  });
});
