import { getShiftInstants, type AttendanceFlag, type AttendanceNextAction, type ScheduleDayType } from "@employee-saas/shared";
import { getWorkDayWeight, type WorkingDaysConfig } from "../../lib/leaveDays.js";

/**
 * The attendance rules as pure functions: architecture-phase2 §1. Nothing here
 * reads the clock or the database, so every rule can be tested with a table of
 * plain values, and the service only has to gather the inputs.
 */

const ONE_MINUTE_MS = 60_000;
const LONG_SHIFT_MINUTES = 16 * 60;

export type EffectiveSchedule = {
  dayType: ScheduleDayType;
  isHalfDayLeave: boolean;
  /** Wall-clock times, null when the day has no schedule (OFF or HOLIDAY). */
  startTime: string | null;
  endTime: string | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  lateGraceMinutes: number;
};

export type ScheduleSettings = {
  workingDays: WorkingDaysConfig;
  workStartTime: string;
  workEndTime: string;
  halfDayEndTime: string;
  lateGraceMinutes: number;
};

/**
 * What someone was supposed to work on a date (§1.2). Per-employee overrides
 * arrive with step 2.6 and will replace the company defaults at the start of this
 * function; every caller is already going through it.
 */
export function resolveEffectiveSchedule(params: {
  workDate: string;
  timezone: string;
  settings: ScheduleSettings;
  isHoliday: boolean;
  /** Approved leave covering this date, if any. */
  leave: "FULL" | "HALF" | null;
}): EffectiveSchedule {
  const { workDate, timezone, settings, isHoliday, leave } = params;
  const weight = getWorkDayWeight(settings.workingDays, workDate);

  if (weight === "OFF" || isHoliday) {
    return {
      dayType: isHoliday ? "HOLIDAY" : "OFF",
      isHalfDayLeave: false,
      startTime: null,
      endTime: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      lateGraceMinutes: settings.lateGraceMinutes,
    };
  }

  const startTime = settings.workStartTime;
  // A shift starting after the half-day end has no morning to shorten, so its
  // half days are worked in full. At exactly the half-day end, using it as the end
  // time would mean "the same time tomorrow".
  const isHalfDay = weight === "HALF" && startTime < settings.halfDayEndTime;
  const endTime = isHalfDay ? settings.halfDayEndTime : settings.workEndTime;

  return {
    dayType: leave === "FULL" ? "ON_LEAVE" : isHalfDay ? "HALF" : "WORKING",
    isHalfDayLeave: leave === "HALF",
    startTime,
    endTime,
    ...getShiftInstants({ workDate, startTime, endTime, timezone }),
    lateGraceMinutes: settings.lateGraceMinutes,
  };
}

/** The flags a check-in earns from the kind of day it is (§1.5). */
export function getCheckInFlags(schedule: EffectiveSchedule): AttendanceFlag[] {
  if (schedule.dayType === "OFF" || schedule.dayType === "HOLIDAY") return ["NON_WORKING_DAY"];
  if (schedule.dayType === "ON_LEAVE") return ["ON_APPROVED_LEAVE"];
  if (schedule.isHalfDayLeave) return ["HALF_DAY_LEAVE"];
  return [];
}

/** §1.4. A check-in on a day with no schedule, or with half a day's leave, is
 * never late: there's no fair time to judge it against. */
export function computeAttendanceStatus(
  record: { checkInAt: Date; checkOutAt: Date | null; autoClosedAt: Date | null },
  schedule: { scheduledStartAt: Date | null; lateGraceMinutes: number; isHalfDayLeave: boolean },
): { status: "PRESENT" | "LATE" | "INCOMPLETE"; lateMinutes: number } {
  const start = schedule.scheduledStartAt;
  const isLate =
    start !== null &&
    !schedule.isHalfDayLeave &&
    record.checkInAt.getTime() > start.getTime() + schedule.lateGraceMinutes * ONE_MINUTE_MS;
  // Counted from the start of the shift, not from the end of the grace period.
  const lateMinutes = isLate ? Math.floor((record.checkInAt.getTime() - start.getTime()) / ONE_MINUTE_MS) : 0;

  if (record.autoClosedAt && !record.checkOutAt) return { status: "INCOMPLETE", lateMinutes };
  return { status: isLate ? "LATE" : "PRESENT", lateMinutes };
}

/** What a check-out adds to a record. */
export function computeCheckOut(record: {
  checkInAt: Date;
  checkOutAt: Date;
  scheduledEndAt: Date | null;
  flags: readonly string[];
}): { workedMinutes: number; earlyLeaveMinutes: number; flags: string[] } {
  const workedMinutes = Math.floor((record.checkOutAt.getTime() - record.checkInAt.getTime()) / ONE_MINUTE_MS);
  // On half-day leave we don't know which half was taken, so leaving early can't
  // be judged any more than arriving late can.
  const earlyLeaveMinutes =
    record.scheduledEndAt && !record.flags.includes("HALF_DAY_LEAVE")
      ? Math.max(0, Math.floor((record.scheduledEndAt.getTime() - record.checkOutAt.getTime()) / ONE_MINUTE_MS))
      : 0;
  const isLong = workedMinutes > LONG_SHIFT_MINUTES && !record.flags.includes("LONG_SHIFT");
  return { workedMinutes, earlyLeaveMinutes, flags: isLong ? [...record.flags, "LONG_SHIFT"] : [...record.flags] };
}

/**
 * When a record stops accepting a check-out (§1.3). A check-in on a day with no
 * schedule has no shift end to count from, so it gets the longest shift allowed.
 */
export function getRecordCloseTime(
  record: { scheduledEndAt: Date | null; checkInAt: Date | null },
  autoCheckoutAfterMinutes: number,
): Date | null {
  if (record.scheduledEndAt) {
    return new Date(record.scheduledEndAt.getTime() + autoCheckoutAfterMinutes * ONE_MINUTE_MS);
  }
  return record.checkInAt ? new Date(record.checkInAt.getTime() + LONG_SHIFT_MINUTES * ONE_MINUTE_MS) : null;
}

/** The table in §1.3. */
export function getNextAction(params: {
  record: { checkInAt: Date | null; checkOutAt: Date | null; autoClosedAt: Date | null; scheduledEndAt: Date | null } | null;
  schedule: { scheduledEndAt: Date | null };
  autoCheckoutAfterMinutes: number;
  now: Date;
}): AttendanceNextAction {
  const { record, schedule, autoCheckoutAfterMinutes, now } = params;

  if (!record) {
    const closeTime = getRecordCloseTime({ scheduledEndAt: schedule.scheduledEndAt, checkInAt: null }, autoCheckoutAfterMinutes);
    return closeTime && now >= closeTime ? "DAY_CLOSED" : "CHECK_IN";
  }
  if (!record.checkInAt) return "DAY_CLOSED";
  if (record.checkOutAt) return "DONE";
  const closeTime = getRecordCloseTime(record, autoCheckoutAfterMinutes);
  return record.autoClosedAt || (closeTime && now >= closeTime) ? "DAY_CLOSED" : "CHECK_OUT";
}
