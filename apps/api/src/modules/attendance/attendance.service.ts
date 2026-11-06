import type { AttendanceRecord, CompanySettings } from "@prisma/client";
import {
  addDaysToIsoDate,
  getWorkDate,
  isModuleEnabled,
  isoDateToUtcDate,
  todayInTimezone,
  utcDateToIsoDate,
  type AttendanceFlag,
  type AttendanceListQuery,
  type AttendanceNextAction,
  type AttendanceRecordDetailDto,
  type AttendanceRecordDto,
  type AttendanceRecordWithCoordinatesDto,
  type AttendanceTodayDto,
  type LocationDto,
  type PaginatedResponse,
  type Role,
} from "@employee-saas/shared";
import { writeAudit } from "../../lib/audit.js";
import { getCompanyTimezone } from "../../lib/companyTime.js";
import { isCompanyModuleEnabled } from "../../lib/enabledModules.js";
import { ApiError } from "../../lib/errors.js";
import {
  checkInColumns,
  checkOutColumns,
  chooseOffice,
  evaluateCheckInLocation,
  evaluateCheckOutLocation,
  toGpsSite,
  type CheckInGpsResult,
  type GpsSite,
} from "../../lib/gpsVerification.js";
import { normalizeWorkingDays } from "../../lib/leaveDays.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";
import { getTenantPrisma, type TenantPrisma } from "../../lib/tenantPrisma.js";
import { buildVisitCheckOut, findOpenVisit, toVisitDto, toVisitWithCoordinatesDto, VISIT_INCLUDE, type VisitRow } from "../siteVisits/siteVisitRows.js";
import { CORRECTION_INCLUDE, toCorrectionDto } from "./correctionRows.js";
import {
  applyScheduleOverride,
  computeAttendanceStatus,
  computeCheckOut,
  getCheckInFlags,
  getLeaveKindOnDate,
  getNextAction,
  getRecordCloseTime,
  resolveEffectiveSchedule,
  type EffectiveSchedule,
  type ScheduleOverride,
  type ScheduleSettings,
} from "./attendance.rules.js";

/** Built from a fixed list of fields rather than by removing some from the row, so
 * a column added later can't reach a manager by default. */
export function toRecordDto(record: AttendanceRecord): AttendanceRecordDto {
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

export function toRecordWithCoordinatesDto(record: AttendanceRecord): AttendanceRecordWithCoordinatesDto {
  return {
    ...toRecordDto(record),
    checkInLat: record.checkInLat?.toNumber() ?? null,
    checkInLng: record.checkInLng?.toNumber() ?? null,
    checkOutLat: record.checkOutLat?.toNumber() ?? null,
    checkOutLng: record.checkOutLng?.toNumber() ?? null,
  };
}

/** The company's working hours with this employee's override, if they have one. It's
 * read fresh on every request: there's nothing here worth a stale-schedule bug. */
export async function getEmployeeScheduleSettings(
  tenant: TenantPrisma,
  companySettings: CompanySettings,
  employeeId: string,
): Promise<ScheduleSettings> {
  const override = await tenant.employeeSchedule.findFirst({ where: { companyId: companySettings.companyId, employeeId } });
  return applyScheduleOverride(
    { ...companySettings, workingDays: normalizeWorkingDays(companySettings.workingDays) },
    override && toScheduleOverride(override),
  );
}

export function toScheduleOverride(row: {
  startTime: string;
  endTime: string;
  workingDays: unknown;
  lateGraceMinutes: number | null;
}): ScheduleOverride {
  return {
    startTime: row.startTime,
    endTime: row.endTime,
    workingDays: row.workingDays === null ? null : normalizeWorkingDays(row.workingDays),
    lateGraceMinutes: row.lateGraceMinutes,
  };
}

export async function getScheduleForDate(params: {
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

  return resolveEffectiveSchedule({
    workDate,
    timezone,
    settings,
    isHoliday: holiday !== null,
    leave:
      leave &&
      getLeaveKindOnDate({ ...leave, startDate: utcDateToIsoDate(leave.startDate), endDate: utcDateToIsoDate(leave.endDate) }, workDate),
  });
}

/** The offices a check-in can belong to. With the `sites` module off, an admin can't
 * see or edit them, so a leftover "GPS required" office mustn't lock anyone out. */
async function getActiveOffices(tenant: TenantPrisma, settings: CompanySettings): Promise<GpsSite[]> {
  if (!isModuleEnabled(settings, "sites")) return [];
  const offices = await tenant.site.findMany({
    where: { companyId: settings.companyId, type: "OFFICE", isActive: true },
    orderBy: { name: "asc" },
  });
  return offices.map(toGpsSite);
}

/** The office a check-out is compared with: the one its check-in used, not whichever
 * is nearest now. A day that started with no office isn't checked at the end either. */
async function getCheckOutSite(tenant: TenantPrisma, settings: CompanySettings, record: AttendanceRecord): Promise<GpsSite | null> {
  if (!record.checkInSiteId || !isModuleEnabled(settings, "sites")) return null;
  const site = await tenant.site.findFirst({ where: { companyId: settings.companyId, id: record.checkInSiteId } });
  return site && toGpsSite(site);
}

/** What the Home card needs to know before the employee taps, given that the phone's
 * location isn't read until they do. */
async function getGpsNeed(
  tenant: TenantPrisma,
  settings: CompanySettings,
  record: AttendanceRecord | null,
  nextAction: AttendanceNextAction,
  openVisit: VisitRow | null,
): Promise<Pick<AttendanceTodayDto, "gpsRequired" | "officeSite">> {
  const summary = (site: GpsSite) => ({ id: site.id, name: site.name, radiusMeters: site.radiusMeters });

  if (nextAction === "CHECK_IN") {
    const offices = await getActiveOffices(tenant, settings);
    return { gpsRequired: offices.some((office) => office.gpsRequired), officeSite: offices.length === 1 ? summary(offices[0]!) : null };
  }
  if (nextAction === "CHECK_OUT") {
    const site = await getCheckOutSite(tenant, settings, record!);
    // A day check-out also closes an open visit (§1.6), which may be the one that checks.
    return { gpsRequired: site?.gpsRequired === true || openVisit?.site.gpsRequired === true, officeSite: site && summary(site) };
  }
  return { gpsRequired: false, officeSite: null };
}

export type CurrentDay = {
  settings: CompanySettings;
  timezone: string;
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
export async function getCurrentDay(params: {
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
  const settings = await getEmployeeScheduleSettings(tenant, row, employeeId);
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
  return { settings: row, timezone, workDate, schedule, record, latestCheckIn, nextAction };
}

export async function getToday(params: { companyId: string; employeeId: string }): Promise<AttendanceTodayDto> {
  const tenant = getTenantPrisma(params.companyId);
  const { settings, workDate, schedule, record, nextAction } = await getCurrentDay({ tenant, ...params, now: new Date() });
  const openVisit = isModuleEnabled(settings, "sites") ? await findOpenVisit(tenant, params) : null;

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
    ...(await getGpsNeed(tenant, settings, record, nextAction, openVisit)),
    openVisit: openVisit && { id: openVisit.id, siteName: openVisit.site.name, checkInAt: openVisit.checkInAt.toISOString() },
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

/** What any check-in that starts a day writes, at the office or at a site. */
export function startOfDayColumns({ workDate, schedule, now }: { workDate: string; schedule: EffectiveSchedule; now: Date }) {
  const { status, lateMinutes } = computeAttendanceStatus({ checkInAt: now, checkOutAt: null, autoClosedAt: null }, schedule);
  return {
    workDate: isoDateToUtcDate(workDate),
    status,
    lateMinutes,
    scheduledStartAt: schedule.scheduledStartAt,
    scheduledEndAt: schedule.scheduledEndAt,
    checkInAt: now,
  };
}

/** Turns a GPS refusal into its error (§3.2). Used for offices and sites alike. */
export async function rejectCheckIn(
  tenant: TenantPrisma,
  params: { companyId: string; userId: string; siteId: string; rejection: Extract<CheckInGpsResult, { rejected: true }> },
): Promise<never> {
  const { companyId, userId, siteId, rejection } = params;
  if (rejection.code === "LOCATION_REQUIRED") {
    throw new ApiError(422, "LOCATION_REQUIRED", "Your location is needed to check in here.");
  }
  if (rejection.code === "OUTSIDE_SITE_RADIUS") {
    const { distanceM, radiusM, siteName } = rejection;
    throw new ApiError(422, "OUTSIDE_SITE_RADIUS", `You are ${distanceM} m from ${siteName}.`, { distanceM, radiusM, siteName });
  }
  // Only mock detection is audited: a deliberate act HR may want to see repeated.
  // The other two are normal "try again" events, and auditing them would store a
  // trail of where someone was. Hence no coordinates here either.
  await writeAudit(tenant, {
    companyId,
    actorUserId: userId,
    action: "ATTENDANCE_CHECKIN_REJECTED",
    entityType: "Site",
    entityId: siteId,
    metadata: { reason: rejection.code, siteId },
  });
  throw new ApiError(422, "MOCK_LOCATION_DETECTED", "This phone is reporting a mock location.");
}

export async function checkIn(params: {
  companyId: string;
  employeeId: string;
  userId: string;
  clientRequestId: string;
  location: LocationDto | null;
}): Promise<{ record: AttendanceRecordWithCoordinatesDto; created: boolean }> {
  const { companyId, employeeId, userId, clientRequestId, location } = params;
  const tenant = getTenantPrisma(companyId);
  const now = new Date();
  const findRetried = () => tenant.attendanceRecord.findFirst({ where: { companyId, employeeId, checkInClientRequestId: clientRequestId } });

  // Before anything else: a retry must get its record back even if the work date
  // has moved on, or the employee has checked out, since the first attempt.
  const retried = await findRetried();
  if (retried) return { record: toRecordWithCoordinatesDto(retried), created: false };

  const { settings, workDate, schedule, record, nextAction } = await getCurrentDay({ tenant, companyId, employeeId, now });
  if (nextAction === "CHECK_OUT") throw alreadyCheckedIn(record!);
  if (nextAction === "DONE") throw alreadyCheckedOut();
  if (nextAction === "DAY_CLOSED") throw dayClosed();

  const offices = await getActiveOffices(tenant, settings);
  const { site, verify } = chooseOffice(offices, location);
  const gps = verify ? evaluateCheckInLocation({ site: site!, location, maxAccuracyM: settings.gpsMaxAccuracyMeters, now }) : null;

  if (gps?.rejected) await rejectCheckIn(tenant, { companyId, userId, siteId: site!.id, rejection: gps });

  const accepted = gps && !gps.rejected ? gps : null;
  const flags: AttendanceFlag[] = [
    ...getCheckInFlags(schedule),
    ...(offices.length === 0 ? (["NO_OFFICE_SITE"] as const) : []),
    ...(accepted?.flags ?? []),
  ];

  try {
    const created = await tenant.attendanceRecord.create({
      data: {
        companyId,
        employeeId,
        ...startOfDayColumns({ workDate, schedule, now }),
        checkInSiteId: site?.id ?? null,
        // Only what passed through the GPS rules. A location sent for an office that
        // doesn't require GPS stops here (Q6), and never reaches a column.
        ...(accepted ? checkInColumns(accepted.reading) : {}),
        flags,
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

export async function checkOut(params: {
  companyId: string;
  employeeId: string;
  location: LocationDto | null;
}): Promise<AttendanceRecordWithCoordinatesDto> {
  const { companyId, employeeId, location } = params;
  const tenant = getTenantPrisma(companyId);
  const now = new Date();

  const { settings, workDate, record, latestCheckIn, nextAction } = await getCurrentDay({ tenant, companyId, employeeId, now });

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

  const site = await getCheckOutSite(tenant, settings, open);
  const gps = site?.gpsRequired
    ? evaluateCheckOutLocation({ site, location, maxAccuracyM: settings.gpsMaxAccuracyMeters, now })
    : null;

  // An open visit ends with the day, at the same instant and with the same location
  // (§1.6). Its own site decides what's kept. It's closed even with `sites` off, since
  // nothing else could close it then, but no position is kept for it.
  const openVisit = await findOpenVisit(tenant, { companyId, employeeId });
  const visitCheckOut =
    openVisit &&
    buildVisitCheckOut({
      visit: openVisit,
      location,
      maxAccuracyM: settings.gpsMaxAccuracyMeters,
      now,
      verifyGps: isModuleEnabled(settings, "sites"),
    });

  await tenant.$transaction(async (tx) => {
    // Conditional, so two simultaneous check-outs can't both write. A check-out
    // doesn't change the status: its inputs are the check-in and the schedule (§1.4).
    const { count } = await tx.attendanceRecord.updateMany({
      where: { companyId, id: open.id, checkOutAt: null, autoClosedAt: null },
      data: {
        checkOutAt,
        ...outcome,
        // Check-in may already have set the same flag, such as a low accuracy.
        flags: [...new Set([...outcome.flags, ...(gps?.flags ?? [])])],
        ...(gps?.reading ? checkOutColumns(gps.reading) : {}),
      },
    });
    if (count === 0) throw alreadyCheckedOut();

    // Conditional too: they may have checked out of the visit a moment ago.
    if (visitCheckOut) {
      await tx.siteVisit.updateMany({ where: { companyId, id: openVisit!.id, status: "OPEN" }, data: visitCheckOut });
    }
  });

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
}): Promise<AttendanceRecordDetailDto> {
  const { companyId, role, callerEmployeeId, recordId } = params;
  const tenant = getTenantPrisma(companyId);
  const record = await tenant.attendanceRecord.findUnique({
    where: { id: recordId },
    include: {
      employee: { select: { managerId: true, firstName: true, lastName: true, employeeCode: true } },
      checkInSite: { select: { name: true } },
      corrections: { include: CORRECTION_INCLUDE, orderBy: { createdAt: "desc" } },
    },
  });
  const notFound = new ApiError(404, "NOT_FOUND", "Attendance record not found.");
  if (!record) throw notFound;

  const isOwner = callerEmployeeId !== null && record.employeeId === callerEmployeeId;
  const seesCoordinates = isOwner || role === "HR" || role === "COMPANY_ADMIN";
  const isTheirManager = role === "MANAGER" && callerEmployeeId !== null && record.employee.managerId === callerEmployeeId;
  if (!seesCoordinates && !isTheirManager) throw notFound;

  const visits = (await isCompanyModuleEnabled(companyId, "sites"))
    ? await tenant.siteVisit.findMany({
        where: { companyId, attendanceRecordId: record.id },
        include: VISIT_INCLUDE,
        orderBy: { checkInAt: "asc" },
      })
    : [];

  const common = {
    employee: { name: `${record.employee.firstName} ${record.employee.lastName}`, code: record.employee.employeeCode },
    siteName: record.checkInSite?.name ?? null,
    corrections: record.corrections.map(toCorrectionDto),
  };
  return seesCoordinates
    ? { ...common, record: toRecordWithCoordinatesDto(record), siteVisits: visits.map(toVisitWithCoordinatesDto) }
    : { ...common, record: toRecordDto(record), siteVisits: visits.map(toVisitDto) };
}
