import { getNoCheckInDay } from "./dayClose.rules.js";
import type { ScheduleSettings } from "./attendance.rules.js";

export const DEFAULT_WORKING_DAYS_FOR_TEST: ScheduleSettings["workingDays"] = {
  mon: "FULL",
  tue: "FULL",
  wed: "FULL",
  thu: "FULL",
  fri: "FULL",
  sat: "HALF",
  sun: "OFF",
};

/** `getNoCheckInDay` with the company defaults filled in, so a test states only what it's about. */
export function getNoCheckInDayForTest(params: {
  workDate: string;
  timezone?: string;
  isHoliday?: boolean;
  leave?: "FULL" | "HALF" | null;
  settings?: Partial<ScheduleSettings>;
}) {
  return getNoCheckInDay({
    workDate: params.workDate,
    timezone: params.timezone ?? "Asia/Colombo",
    isHoliday: params.isHoliday ?? false,
    leave: params.leave ?? null,
    autoCheckoutAfterMinutes: 240,
    settings: {
      workingDays: DEFAULT_WORKING_DAYS_FOR_TEST,
      workStartTime: "09:00",
      workEndTime: "17:00",
      halfDayEndTime: "13:00",
      lateGraceMinutes: 10,
      ...params.settings,
    },
  });
}
