import { describe, expect, it } from "@jest/globals";
import type { ScheduleDayDto } from "@employee-saas/shared";
import { scheduleDayText } from "./schedule";
import { strings } from "../strings";

const TIMEZONE = "Asia/Colombo";

function day(overrides: Partial<ScheduleDayDto> = {}): ScheduleDayDto {
  return {
    date: "2026-11-03",
    dayType: "WORKING",
    isHalfDayLeave: false,
    scheduledStartAt: "2026-11-03T03:30:00.000Z", // 09:00 in Colombo
    scheduledEndAt: "2026-11-03T11:30:00.000Z", // 17:00
    ...overrides,
  };
}

describe("scheduleDayText", () => {
  it("a working day, in company time", () => {
    expect(scheduleDayText(day(), TIMEZONE)).toBe("09:00 - 17:00");
  });

  it("a night shift says it ends the next day", () => {
    const night = day({ scheduledStartAt: "2026-11-03T16:30:00.000Z", scheduledEndAt: "2026-11-04T00:30:00.000Z" });
    expect(scheduleDayText(night, TIMEZONE)).toBe(`22:00 - 06:00 (${strings.schedule.nextDay})`);
  });

  it("a day that's only 'next day' in UTC doesn't say so", () => {
    // 22:00-23:30 in Colombo ends on the 3rd there, and 18:00 on the 3rd in UTC.
    const late = day({ scheduledStartAt: "2026-11-03T16:30:00.000Z", scheduledEndAt: "2026-11-03T18:00:00.000Z" });
    expect(scheduleDayText(late, TIMEZONE)).toBe("22:00 - 23:30");
  });

  it("a half day, and half a day's leave, say so", () => {
    expect(scheduleDayText(day({ dayType: "HALF", scheduledEndAt: "2026-11-03T07:30:00.000Z" }), TIMEZONE)).toBe(`09:00 - 13:00 · ${strings.schedule.halfDay}`);
    expect(scheduleDayText(day({ isHalfDayLeave: true }), TIMEZONE)).toBe(`09:00 - 17:00 · ${strings.schedule.halfDayLeave}`);
  });

  it.each([
    ["OFF", strings.schedule.dayOff],
    ["HOLIDAY", strings.schedule.holiday],
  ] as const)("%s has no times", (dayType, text) => {
    expect(scheduleDayText(day({ dayType, scheduledStartAt: null, scheduledEndAt: null }), TIMEZONE)).toBe(text);
  });

  it("approved leave doesn't show the hours they'd have worked", () => {
    expect(scheduleDayText(day({ dayType: "ON_LEAVE" }), TIMEZONE)).toBe(strings.schedule.onLeave);
  });
});
