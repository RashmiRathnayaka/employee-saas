import { getShiftInstants, minutesOfDay, type AttendanceFlag, type AttendanceNextAction, type ScheduleDayType } from "@employee-saas/shared";
import { getWorkDayWeight, type WorkingDaysConfig } from "../../lib/leaveDays.js";

/**
 * The attendance rules as pure functions: architecture-phase2 §1. Nothing here
 * reads the clock or the database, so every rule can be tested with a table of
 * plain values, and the service only has to gather the inputs.
 */

const ONE_MINUTE_MS = 60_000;
const LONG_SHIFT_MINUTES = 16 * 60;
const MINUTES_IN_A_DAY = 24 * 60;

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
  /** These hours are a per-employee override, so its HALF days are half of its own shift. */
  isOverride?: boolean;
};

export type ScheduleOverride = {
  startTime: string;
  endTime: string;
  /** Null follows the company's week. */
  workingDays: WorkingDaysConfig | null;
  /** Null follows the company's grace period. */
  lateGraceMinutes: number | null;
};

/** A per-employee override takes the company defaults' place (§1.2). Every caller of
 * `resolveEffectiveSchedule` passes settings through this first. */
export function applyScheduleOverride(settings: ScheduleSettings, override: ScheduleOverride | null): ScheduleSettings {
  if (!override) return settings;
  return {
    ...settings,
    workStartTime: override.startTime,
    workEndTime: override.endTime,
    workingDays: override.workingDays ?? settings.workingDays,
    lateGraceMinutes: override.lateGraceMinutes ?? settings.lateGraceMinutes,
    isOverride: true,
  };
}

/** When the first half of a shift ends: 22:00-06:00 gives 02:00. An odd minute rounds
 * down, and an end at or before the start is the next day, as in `getShiftInstants`. */
function getFirstHalfEndTime(startTime: string, endTime: string): string {
  const start = minutesOfDay(startTime);
  const length = ((minutesOfDay(endTime) - start + MINUTES_IN_A_DAY - 1) % MINUTES_IN_A_DAY) + 1;
  const end = (start + Math.floor(length / 2)) % MINUTES_IN_A_DAY;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
}

/** Where a shift ends on this day, and whether a HALF day actually shortens it (§1.2). */
function getShiftEnd(settings: ScheduleSettings, weight: "FULL" | "HALF"): { isHalfDay: boolean; endTime: string } {
  const { workStartTime: startTime, workEndTime, halfDayEndTime } = settings;
  if (settings.isOverride) {
    return weight === "HALF"
      ? { isHalfDay: true, endTime: getFirstHalfEndTime(startTime, workEndTime) }
      : { isHalfDay: false, endTime: workEndTime };
  }
  // Company hours starting after the half-day end have no morning to shorten, so their
  // half days are worked in full. At exactly the half-day end, using it as the end time
  // would mean "the same time tomorrow".
  const isHalfDay = weight === "HALF" && startTime < halfDayEndTime;
  // A shift that's already over by the half-day end isn't made longer by it.
  const endsBeforeHalfDayEnd = workEndTime > startTime && workEndTime < halfDayEndTime;
  return { isHalfDay, endTime: isHalfDay && !endsBeforeHalfDayEnd ? halfDayEndTime : workEndTime };
}

/** What approved leave means for one date, given a leave covering it. */
export function getLeaveKindOnDate(
  leave: { startDate: string; endDate: string; startHalfDay: boolean; endHalfDay: boolean },
  workDate: string,
): "FULL" | "HALF" {
  return (leave.startHalfDay && leave.startDate === workDate) || (leave.endHalfDay && leave.endDate === workDate) ? "HALF" : "FULL";
}

/** What someone was supposed to work on a date (§1.2). */
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
  const { isHalfDay, endTime } = getShiftEnd(settings, weight);

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
 * Everything that follows from a record's times, after HR changes them (§1.7). HR
 * never sets these directly. It uses the record's own schedule snapshot, so a schedule
 * changed since doesn't rewrite the day. GPS flags stay as captured, and only
 * `LONG_SHIFT` can be earned or lost here.
 */
export function computeCorrectedRecord(record: {
  checkInAt: Date;
  checkOutAt: Date | null;
  autoClosedAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  lateGraceMinutes: number;
  flags: readonly string[];
}): { status: "PRESENT" | "LATE" | "INCOMPLETE"; lateMinutes: number; workedMinutes: number | null; earlyLeaveMinutes: number; flags: string[] } {
  const { status, lateMinutes } = computeAttendanceStatus(record, {
    scheduledStartAt: record.scheduledStartAt,
    lateGraceMinutes: record.lateGraceMinutes,
    isHalfDayLeave: record.flags.includes("HALF_DAY_LEAVE"),
  });
  const flags = record.flags.filter((flag) => flag !== "LONG_SHIFT");
  if (!record.checkOutAt) return { status, lateMinutes, workedMinutes: null, earlyLeaveMinutes: 0, flags };

  const closed = computeCheckOut({ checkInAt: record.checkInAt, checkOutAt: record.checkOutAt, scheduledEndAt: record.scheduledEndAt, flags });
  return { status, lateMinutes, ...closed };
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
