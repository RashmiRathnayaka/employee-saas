import type { AttendanceRecord } from "@prisma/client";
import {
  addDaysToIsoDate,
  getWorkDate,
  isoDateToUtcDate,
  todayInTimezone,
  utcDateToIsoDate,
  type AttendanceFlag,
  type AttendanceListQuery,
  type AttendanceNextAction,
  type AttendanceRecordDto,
  type AttendanceRecordWithCoordinatesDto,
  type AttendanceTodayDto,
  type PaginatedResponse,
  type Role,
} from "@employee-saas/shared";
import { getCompanyTimezone } from "../../lib/companyTime.js";
import { ApiError } from "../../lib/errors.js";
import { normalizeWorkingDays } from "../../lib/leaveDays.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";
import { getTenantPrisma, type TenantPrisma } from "../../lib/tenantPrisma.js";
import {
  computeAttendanceStatus,
  computeCheckOut,
  getCheckInFlags,
  getNextAction,
  getRecordCloseTime,
  resolveEffectiveSchedule,
  type EffectiveSchedule,
  type ScheduleSettings,
} from "./attendance.rules.js";

/** Built from a fixed list of fields rather than by removing some from the row, so
 * a column added later can't reach a manager by default. */
function toRecordDto(record: AttendanceRecord): AttendanceRecordDto {
  return {
    id: record.id,
    employeeId: record.employeeId,
    workDate: utcDateToIsoDate(record.workDate),
    status: record.status,
    scheduledStartAt: record.scheduledStartAt?.toISOString() ?? null,
    scheduledEndAt: record.scheduledEndAt?.toISOString() ?? null,
    checkInAt: record.checkInAt?.toISOString() ?? null,
    checkOutAt: record.checkOutAt?.toISOString() ?? null,
    workedMinutes: record.workedMinutes,
    lateMinutes: record.lateMinutes,
    earlyLeaveMinutes: record.earlyLeaveMinutes,
    checkInSiteId: record.checkInSiteId,
    checkInAccuracyM: record.checkInAccuracyM,
    checkInDistanceM: record.checkInDistanceM,
    checkInWithinRadius: record.checkInWithinRadius,
    checkInMocked: record.checkInMocked,
    checkOutAccuracyM: record.checkOutAccuracyM,
    checkOutDistanceM: record.checkOutDistanceM,
    checkOutWithinRadius: record.checkOutWithinRadius,
    checkOutMocked: record.checkOutMocked,
    flags: record.flags as AttendanceFlag[],
    source: record.source,
    autoClosedAt: record.autoClosedAt?.toISOString() ?? null,
    isCorrected: record.isCorrected,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toRecordWithCoordinatesDto(record: AttendanceRecord): AttendanceRecordWithCoordinatesDto {
  return {
    ...toRecordDto(record),
    checkInLat: record.checkInLat?.toNumber() ?? null,
    checkInLng: record.checkInLng?.toNumber() ?? null,
    checkOutLat: record.checkOutLat?.toNumber() ?? null,
    checkOutLng: record.checkOutLng?.toNumber() ?? null,
  };
}

async function getScheduleForDate(params: {
  tenant: TenantPrisma;
  companyId: string;
  employeeId: string;
  workDate: string;
  timezone: string;
  settings: ScheduleSettings;
}): Promise<EffectiveSchedule> {
  const { tenant, companyId, employeeId, workDate, timezone, settings } = params;
  const date = isoDateToUtcDate(workDate);

  const [holiday, leave] = await Promise.all([
    tenant.companyHoliday.findFirst({ where: { companyId, date }, select: { id: true } }),
    tenant.leaveRequest.findFirst({
      where: { companyId, employeeId, status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } },
      select: { startDate: true, endDate: true, startHalfDay: true, endHalfDay: true },
    }),
  ]);

  const isHalf =
    leave !== null &&
    ((leave.startHalfDay && utcDateToIsoDate(leave.startDate) === workDate) ||
      (leave.endHalfDay && utcDateToIsoDate(leave.endDate) === workDate));

  return resolveEffectiveSchedule({
    workDate,
    timezone,
    settings,
    isHoliday: holiday !== null,
    leave: leave === null ? null : isHalf ? "HALF" : "FULL",
  });
}

type CurrentDay = {
  workDate: string;
  schedule: EffectiveSchedule;
  /** The record the employee is acting on now, if any (§1.3). */
  record: AttendanceRecord | null;
  /** Their latest record with a check-in. It may be an older day's. */
  latestCheckIn: AttendanceRecord | null;
  nextAction: AttendanceNextAction;
};

/**
 * Where this employee stands right now: architecture-phase2 §1.3. Check-in,
 * check-out and the Home card all start here, so they can't disagree.
 *
 * It looks for a record that's still within its close time before working out a
 * date, which is what lets a night worker check out at 06:30 of a shift that ended
 * at 06:00: by the date rule alone that's already tomorrow's work date.
 */
async function getCurrentDay(params: {
  tenant: TenantPrisma;
  companyId: string;
  employeeId: string;
  now: Date;
}): Promise<CurrentDay> {
  const { tenant, companyId, employeeId, now } = params;
  const [row, timezone, latestCheckIn] = await Promise.all([
    tenant.companySettings.findUniqueOrThrow({ where: { companyId } }),
    getCompanyTimezone(companyId),
    tenant.attendanceRecord.findFirst({
      where: { companyId, employeeId, checkInAt: { not: null } },
      orderBy: { workDate: "desc" },
    }),
  ]);
  const settings: ScheduleSettings = { ...row, workingDays: normalizeWorkingDays(row.workingDays) };
  const scheduleFor = (workDate: string) => getScheduleForDate({ tenant, companyId, employeeId, workDate, timezone, settings });

  const latestCloseTime = latestCheckIn && getRecordCloseTime(latestCheckIn, row.autoCheckoutAfterMinutes);
  const latestIsCurrent = latestCloseTime !== null && now < latestCloseTime;

  let workDate: string;
  let record: AttendanceRecord | null;
  if (latestIsCurrent) {
    workDate = utcDateToIsoDate(latestCheckIn!.workDate);
    record = latestCheckIn;
  } else {
    const yesterday = await scheduleFor(addDaysToIsoDate(todayInTimezone(timezone, now), -1));
    workDate = getWorkDate({
      now,
      timezone,
      previousDaySchedule: yesterday.startTime && yesterday.endTime ? { startTime: yesterday.startTime, endTime: yesterday.endTime } : null,
    });
    record = await tenant.attendanceRecord.findFirst({ where: { companyId, employeeId, workDate: isoDateToUtcDate(workDate) } });
  }

  const schedule = await scheduleFor(workDate);
  const nextAction = getNextAction({ record, schedule, autoCheckoutAfterMinutes: row.autoCheckoutAfterMinutes, now });
  return { workDate, schedule, record, latestCheckIn, nextAction };
}

export async function getToday(params: { companyId: string; employeeId: string }): Promise<AttendanceTodayDto> {
  const tenant = getTenantPrisma(params.companyId);
  const { workDate, schedule, record, nextAction } = await getCurrentDay({ tenant, ...params, now: new Date() });

  // A record shows the schedule it was judged against, which may since have changed.
  const start = record?.scheduledStartAt ?? schedule.scheduledStartAt;
  const end = record?.scheduledEndAt ?? schedule.scheduledEndAt;
  return {
    workDate,
    schedule: {
      dayType: schedule.dayType,
      isHalfDayLeave: schedule.isHalfDayLeave,
      scheduledStartAt: start?.toISOString() ?? null,
      scheduledEndAt: end?.toISOString() ?? null,
      lateGraceMinutes: schedule.lateGraceMinutes,
    },
    record: record && toRecordWithCoordinatesDto(record),
    nextAction,
  };
}

function alreadyCheckedIn(record: AttendanceRecord) {
  return new ApiError(409, "ALREADY_CHECKED_IN", "You've already checked in.", { record: toRecordWithCoordinatesDto(record) });
}

function alreadyCheckedOut() {
  return new ApiError(409, "ALREADY_CHECKED_OUT", "You've already checked out.");
}

function dayClosed() {
  return new ApiError(409, "DAY_ALREADY_CLOSED", "This day has closed. Ask HR to correct it.");
}

export async function checkIn(params: {
  companyId: string;
  employeeId: string;
  clientRequestId: string;
}): Promise<{ record: AttendanceRecordWithCoordinatesDto; created: boolean }> {
  const { companyId, employeeId, clientRequestId } = params;
  const tenant = getTenantPrisma(companyId);
  const now = new Date();
  const findRetried = () => tenant.attendanceRecord.findFirst({ where: { companyId, employeeId, checkInClientRequestId: clientRequestId } });

  // Before anything else: a retry must get its record back even if the work date
  // has moved on, or the employee has checked out, since the first attempt.
  const retried = await findRetried();
  if (retried) return { record: toRecordWithCoordinatesDto(retried), created: false };

  const { workDate, schedule, record, nextAction } = await getCurrentDay({ tenant, companyId, employeeId, now });
  if (nextAction === "CHECK_OUT") throw alreadyCheckedIn(record!);
  if (nextAction === "DONE") throw alreadyCheckedOut();
  if (nextAction === "DAY_CLOSED") throw dayClosed();

  const { status, lateMinutes } = computeAttendanceStatus({ checkInAt: now, checkOutAt: null, autoClosedAt: null }, schedule);
  try {
    const created = await tenant.attendanceRecord.create({
      data: {
        companyId,
        employeeId,
        workDate: isoDateToUtcDate(workDate),
        status,
        lateMinutes,
        scheduledStartAt: schedule.scheduledStartAt,
        scheduledEndAt: schedule.scheduledEndAt,
        checkInAt: now,
        flags: getCheckInFlags(schedule),
        source: "MOBILE",
        checkInClientRequestId: clientRequestId,
      },
    });
    return { record: toRecordWithCoordinatesDto(created), created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Another request got there first. The unique indexes are what make this safe:
    // both requests can pass the checks above, but only one insert can succeed.
    const sameTap = await findRetried();
    if (sameTap) return { record: toRecordWithCoordinatesDto(sameTap), created: false };
    throw alreadyCheckedIn(
      await tenant.attendanceRecord.findFirstOrThrow({ where: { companyId, employeeId, workDate: isoDateToUtcDate(workDate) } }),
    );
  }
}

export async function checkOut(params: { companyId: string; employeeId: string }): Promise<AttendanceRecordWithCoordinatesDto> {
  const { companyId, employeeId } = params;
  const tenant = getTenantPrisma(companyId);
  const now = new Date();

  const { workDate, record, latestCheckIn, nextAction } = await getCurrentDay({ tenant, companyId, employeeId, now });

  if (nextAction === "DONE") throw alreadyCheckedOut();
  if (nextAction !== "CHECK_OUT") {
    // Still open, or auto-closed, and recent: a night worker past their close time,
    // whose date has moved on. "You never checked in" would be untrue.
    const unfinished =
      latestCheckIn !== null &&
      !latestCheckIn.checkOutAt &&
      utcDateToIsoDate(latestCheckIn.workDate) >= addDaysToIsoDate(workDate, -1);
    if (unfinished) throw dayClosed();
    throw new ApiError(409, "NOT_CHECKED_IN", "You haven't checked in.");
  }

  const open = record!;
  const checkInAt = open.checkInAt!;
  // The database requires check-out after check-in, and two API servers' clocks can
  // differ slightly. This is the only place that could break it.
  const checkOutAt = now > checkInAt ? now : new Date(checkInAt.getTime() + 1);
  const outcome = computeCheckOut({ checkInAt, checkOutAt, scheduledEndAt: open.scheduledEndAt, flags: open.flags });

  // Conditional, so two simultaneous check-outs can't both write. A check-out
  // doesn't change the status: its inputs are the check-in and the schedule (§1.4).
  const { count } = await tenant.attendanceRecord.updateMany({
    where: { companyId, id: open.id, checkOutAt: null, autoClosedAt: null },
    data: { checkOutAt, ...outcome },
  });
  if (count === 0) throw alreadyCheckedOut();

  return toRecordWithCoordinatesDto(await tenant.attendanceRecord.findUniqueOrThrow({ where: { id: open.id } }));
}

export async function listMyRecords(params: {
  companyId: string;
  employeeId: string;
  query: AttendanceListQuery;
}): Promise<PaginatedResponse<AttendanceRecordWithCoordinatesDto>> {
  const { companyId, employeeId } = params;
  const { page, pageSize, from, to } = params.query;
  const tenant = getTenantPrisma(companyId);

  const where = {
    companyId,
    employeeId,
    ...(from || to
      ? { workDate: { ...(from ? { gte: isoDateToUtcDate(from) } : {}), ...(to ? { lte: isoDateToUtcDate(to) } : {}) } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    tenant.attendanceRecord.findMany({ where, orderBy: { workDate: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    tenant.attendanceRecord.count({ where }),
  ]);
  return { data: rows.map(toRecordWithCoordinatesDto), page, pageSize, total };
}

/** Deny by default: anyone not named here gets the same 404 as a record that
 * doesn't exist, so they can't tell it's there. */
export async function getRecord(params: {
  companyId: string;
  role: Role;
  callerEmployeeId: string | null;
  recordId: string;
}): Promise<AttendanceRecordDto | AttendanceRecordWithCoordinatesDto> {
  const { companyId, role, callerEmployeeId, recordId } = params;
  const record = await getTenantPrisma(companyId).attendanceRecord.findUnique({
    where: { id: recordId },
    include: { employee: { select: { managerId: true } } },
  });
  const notFound = new ApiError(404, "NOT_FOUND", "Attendance record not found.");
  if (!record) throw notFound;

  const isOwner = callerEmployeeId !== null && record.employeeId === callerEmployeeId;
  if (isOwner || role === "HR" || role === "COMPANY_ADMIN") return toRecordWithCoordinatesDto(record);

  const isTheirManager = role === "MANAGER" && callerEmployeeId !== null && record.employee.managerId === callerEmployeeId;
  if (isTheirManager) return toRecordDto(record);

  throw notFound;
}
