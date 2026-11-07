import { addDaysToIsoDate, zonedDateTimeToUtc, type AttendanceFlag } from "@employee-saas/shared";
import { getWorkDayWeight } from "../../lib/leaveDays.js";
import { LONG_SHIFT_MINUTES, resolveEffectiveSchedule, type EffectiveSchedule, type ScheduleSettings } from "./attendance.rules.js";

/**
 * Day close's rules as pure functions: architecture-phase2 §5.4. Nothing here reads
 * the clock or the database.
 */

const ONE_MINUTE_MS = 60_000;

export const CATCH_UP_DAYS = 2;
/** A forgotten visit has no shift to end with, so it gets the longest shift allowed. */
export const OPEN_VISIT_MAX_MINUTES = LONG_SHIFT_MINUTES;

export type NoCheckInStatus = "ON_LEAVE" | "HOLIDAY" | "ABSENT";

/**
 * What a day with no check-in counts as. A holiday beats leave, as in §1.2: a leave
 * doesn't spend a day on a holiday. Half a day's leave still counts as on leave (Q8).
 */
export function getNoCheckInOutcome(params: { isHoliday: boolean; leave: "FULL" | "HALF" | null }): {
  status: NoCheckInStatus;
  flags: AttendanceFlag[];
} {
  if (params.isHoliday) return { status: "HOLIDAY", flags: [] };
  if (params.leave === "FULL") return { status: "ON_LEAVE", flags: [] };
  if (params.leave === "HALF") return { status: "ON_LEAVE", flags: ["HALF_DAY_LEAVE"] };
  return { status: "ABSENT", flags: [] };
}

/**
 * When a no-show on this date can be written down, or null for a weekly off day, which
 * writes no row (§1.4). A holiday on a weekly off day is still an off day.
 *
 * The schedule comes from `resolveEffectiveSchedule`, the same as a check-in, so an
 * override's night shift or half day closes when that shift does.
 *
 * A holiday has no shift, and anyone may still check in during it (§1.5). A row would
 * refuse that (§1.3), so it waits until the date has moved on, at midnight.
 */
export function getNoCheckInDay(params: {
  workDate: string;
  timezone: string;
  settings: ScheduleSettings;
  isHoliday: boolean;
  leave: "FULL" | "HALF" | null;
  autoCheckoutAfterMinutes: number;
}): { closeAt: Date; startsAt: Date; schedule: EffectiveSchedule } | null {
  const { workDate, timezone, settings, isHoliday, leave, autoCheckoutAfterMinutes } = params;
  if (getWorkDayWeight(settings.workingDays, workDate) === "OFF") return null;

  const schedule = resolveEffectiveSchedule({ workDate, timezone, settings, isHoliday, leave });
  if (!schedule.scheduledStartAt || !schedule.scheduledEndAt) {
    return {
      closeAt: zonedDateTimeToUtc(addDaysToIsoDate(workDate, 1), "00:00", timezone),
      startsAt: zonedDateTimeToUtc(workDate, "00:00", timezone),
      schedule,
    };
  }
  return {
    closeAt: new Date(schedule.scheduledEndAt.getTime() + autoCheckoutAfterMinutes * ONE_MINUTE_MS),
    startsAt: schedule.scheduledStartAt,
    schedule,
  };
}

/**
 * A no-show only counts if the employee could have checked in: the module has to have
 * been on when the day started. Null means it hasn't been switched on through settings,
 * so nothing is marked rather than risking a false ABSENT.
 */
export function wasAttendanceOnAtStart(attendanceEnabledAt: Date | null, startsAt: Date): boolean {
  return attendanceEnabledAt !== null && attendanceEnabledAt <= startsAt;
}

/** The dates day close still looks at, oldest first (§5.4's catch-up). */
export function getCatchUpDates(today: string): string[] {
  return Array.from({ length: CATCH_UP_DAYS + 1 }, (_, i) => addDaysToIsoDate(today, i - CATCH_UP_DAYS));
}

/** Where a date stands, given each distinct set of hours in the company: nobody's close
 * time has come, some have, or all have. Null when nobody works that date. */
export function getDateCloseState(closeTimes: Date[], now: Date): "WAITING" | "PARTLY_CLOSED" | "FINISHED" | null {
  if (closeTimes.length === 0) return null;
  const passed = closeTimes.filter((closeAt) => now >= closeAt).length;
  if (passed === 0) return "WAITING";
  return passed === closeTimes.length ? "FINISHED" : "PARTLY_CLOSED";
}

/** What closing a forgotten record writes. `lateMinutes` and the times stay as they are,
 * and `workedMinutes` stays null: nobody knows when they left (§1.4). */
export function getAutoCloseColumns(flags: readonly string[], now: Date) {
  return {
    status: "INCOMPLETE" as const,
    autoClosedAt: now,
    flags: [...new Set([...flags, "AUTO_CLOSED"])],
  };
}

/** The moment a record stops being open is `getRecordCloseTime`. This is the same rule
 * turned around, for a query: which rows have reached it by `now`? */
export function getAutoCloseCutoffs(now: Date, autoCheckoutAfterMinutes: number) {
  return {
    scheduledEndAtOrBefore: new Date(now.getTime() - autoCheckoutAfterMinutes * ONE_MINUTE_MS),
    noScheduleCheckInAtOrBefore: new Date(now.getTime() - LONG_SHIFT_MINUTES * ONE_MINUTE_MS),
  };
}

/** A visit found on a day marked ABSENT: the contradiction HR's daily report shows (§1.6). */
export function toAbsentDayVisitFlags(flags: readonly string[]): string[] {
  return [...new Set([...flags.filter((flag) => flag !== "AFTER_HOURS"), "ON_ABSENT_DAY"])];
}
