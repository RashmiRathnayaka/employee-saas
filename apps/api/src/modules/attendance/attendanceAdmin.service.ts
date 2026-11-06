import type { Prisma } from "@prisma/client";
import {
  formatDate,
  isModuleEnabled,
  isoDateToUtcDate,
  todayInTimezone,
  utcDateToIsoDate,
  type AttendanceAdminListQuery,
  type AttendanceListRowDto,
  type AttendanceRecordWithCoordinatesDto,
  type CorrectAttendanceRequest,
  type CorrectedFieldsDto,
  type CreateAttendanceRequest,
  type PaginatedResponse,
} from "@employee-saas/shared";
import { writeAudit } from "../../lib/audit.js";
import { diffFields } from "../../lib/auditDiff.js";
import { getCompanyTimezone } from "../../lib/companyTime.js";
import { ApiError } from "../../lib/errors.js";
import { withNote, createNotification } from "../../lib/notifications.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";
import { getTenantPrisma, type TenantPrisma } from "../../lib/tenantPrisma.js";
import { computeCorrectedRecord, getCheckInFlags } from "./attendance.rules.js";
import { getEmployeeScheduleSettings, getScheduleForDate, toRecordDto, toRecordWithCoordinatesDto } from "./attendance.service.js";
import { assertCorrectedTimes, cannotCorrectOwn, nothingToCorrect, recordChanged } from "./correctionRules.js";

/** HR's and managers' side of attendance: the lists and the corrections (§1.7). */

const LIST_INCLUDE = {
  employee: { select: { firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } } },
  checkInSite: { select: { name: true } },
  siteVisits: { select: { flags: true } },
} satisfies Prisma.AttendanceRecordInclude;

type ListRow = Prisma.AttendanceRecordGetPayload<{ include: typeof LIST_INCLUDE }>;

function toListRowDto(row: ListRow, sitesEnabled: boolean): AttendanceListRowDto {
  // Only while the row is still ABSENT: once HR corrects it, or approved leave flips it,
  // the contradiction is resolved (§1.6). The flag stays on the visit as a record.
  const onAbsentDay = sitesEnabled && row.status === "ABSENT" && row.siteVisits.some((visit) => visit.flags.includes("ON_ABSENT_DAY"));
  return {
    ...toRecordDto(row),
    employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
    employeeCode: row.employee.employeeCode,
    departmentName: row.employee.department?.name ?? null,
    siteName: row.checkInSite?.name ?? null,
    siteVisitFlags: onAbsentDay ? ["ON_ABSENT_DAY"] : [],
  };
}

async function listPage(
  companyId: string,
  query: AttendanceAdminListQuery,
  employeeScope: Prisma.EmployeeWhereInput,
): Promise<PaginatedResponse<AttendanceListRowDto>> {
  const tenant = getTenantPrisma(companyId);
  const { page, pageSize, date, from, to, employeeId, departmentId, status, flag } = query;

  const workDate = date
    ? isoDateToUtcDate(date)
    : from || to
      ? { ...(from ? { gte: isoDateToUtcDate(from) } : {}), ...(to ? { lte: isoDateToUtcDate(to) } : {}) }
      : undefined;

  const where: Prisma.AttendanceRecordWhereInput = {
    companyId,
    ...(workDate ? { workDate } : {}),
    ...(employeeId ? { employeeId } : {}),
    ...(status ? { status } : {}),
    ...(flag ? { flags: { has: flag } } : {}),
    employee: { ...employeeScope, ...(departmentId ? { departmentId } : {}) },
  };

  const [rows, total, settings] = await Promise.all([
    tenant.attendanceRecord.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: [{ workDate: "desc" }, { employee: { firstName: "asc" } }, { employee: { lastName: "asc" } }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    tenant.attendanceRecord.count({ where }),
    tenant.companySettings.findUniqueOrThrow({ where: { companyId } }),
  ]);
  const sitesEnabled = isModuleEnabled(settings, "sites");
  return { data: rows.map((row) => toListRowDto(row, sitesEnabled)), page, pageSize, total };
}

export function listAllRecords(params: { companyId: string; query: AttendanceAdminListQuery }) {
  return listPage(params.companyId, params.query, {});
}

/** Direct reports only. An `employeeId` outside the team just finds nothing. */
export function listTeamRecords(params: { companyId: string; managerEmployeeId: string; query: AttendanceAdminListQuery }) {
  return listPage(params.companyId, params.query, { managerId: params.managerEmployeeId });
}

/** A correction can only name an office, and only while HR can see sites at all.
 * Inactive offices are allowed: a past day may well have been at one. */
async function findOffice(tenant: TenantPrisma, companyId: string, siteId: string) {
  const settings = await tenant.companySettings.findUniqueOrThrow({ where: { companyId } });
  if (!isModuleEnabled(settings, "sites")) {
    throw new ApiError(403, "MODULE_DISABLED", "The sites module is turned off for this company.", { module: "sites" });
  }
  const office = await tenant.site.findFirst({ where: { companyId, id: siteId, type: "OFFICE" } });
  if (!office) throw new ApiError(404, "NOT_FOUND", "Office not found.");
  return office;
}

/** The employee hears about it if they can log in to see it. In the same transaction,
 * so a rolled-back correction never leaves a notification behind. */
async function notifyEmployee(
  tx: Pick<TenantPrisma, "user" | "notification">,
  params: { companyId: string; employeeId: string; recordId: string; workDate: string; reason: string },
) {
  const { companyId, employeeId, recordId, workDate, reason } = params;
  const login = await tx.user.findFirst({ where: { companyId, employeeId, status: "ACTIVE" }, select: { id: true } });
  if (!login) return;
  await createNotification(tx, {
    companyId,
    userId: login.id,
    type: "ATTENDANCE_CORRECTED",
    title: "Attendance corrected",
    body: withNote(`HR corrected your attendance for ${formatDate(workDate)}.`, reason, "Reason"),
    relatedEntityType: "AttendanceRecord",
    relatedEntityId: recordId,
  });
}

const CORRECTED_FIELDS = ["checkInAt", "checkOutAt", "status", "siteName"];

function correctionFields(row: {
  checkInAt: Date | null;
  checkOutAt: Date | null;
  status: string;
  siteName: string | null;
}): Required<CorrectedFieldsDto> {
  return {
    checkInAt: row.checkInAt?.toISOString() ?? null,
    checkOutAt: row.checkOutAt?.toISOString() ?? null,
    status: row.status,
    siteName: row.siteName,
  };
}

/** Only a night shift's check-in can fall on the day after its work date. */
function crossesMidnight(scheduledEndAt: Date | null, workDate: string, timezone: string): boolean {
  return scheduledEndAt !== null && todayInTimezone(timezone, scheduledEndAt) > workDate;
}

export async function correctRecord(params: {
  companyId: string;
  actorUserId: string;
  actorEmployeeId: string | null;
  recordId: string;
  data: CorrectAttendanceRequest;
}): Promise<AttendanceRecordWithCoordinatesDto> {
  const { companyId, actorUserId, actorEmployeeId, recordId, data } = params;
  const tenant = getTenantPrisma(companyId);
  const now = new Date();

  const record = await tenant.attendanceRecord.findFirst({
    where: { companyId, id: recordId },
    include: { checkInSite: { select: { name: true } } },
  });
  if (!record) throw new ApiError(404, "NOT_FOUND", "Attendance record not found.");
  if (actorEmployeeId !== null && record.employeeId === actorEmployeeId) throw cannotCorrectOwn();

  const timezone = await getCompanyTimezone(companyId);
  const workDate = utcDateToIsoDate(record.workDate);
  const settingsRow = await tenant.companySettings.findUniqueOrThrow({ where: { companyId } });
  const settings = await getEmployeeScheduleSettings(tenant, settingsRow, record.employeeId);
  const schedule = await getScheduleForDate({ tenant, companyId, employeeId: record.employeeId, workDate, timezone, settings });

  // A row day close wrote has no check-in, and may have no schedule snapshot. Once it
  // has times it needs both, and the same flags a check-in that day would have earned.
  const hadNoCheckIn = !record.checkInAt;
  const scheduledStartAt = hadNoCheckIn ? (record.scheduledStartAt ?? schedule.scheduledStartAt) : record.scheduledStartAt;
  const scheduledEndAt = hadNoCheckIn ? (record.scheduledEndAt ?? schedule.scheduledEndAt) : record.scheduledEndAt;
  const baseFlags = hadNoCheckIn ? [...new Set([...record.flags, ...getCheckInFlags(schedule)])] : record.flags;

  const checkInAt = data.checkInAt ? new Date(data.checkInAt) : record.checkInAt;
  const checkOutAt = data.checkOutAt ? new Date(data.checkOutAt) : record.checkOutAt;
  if (!checkInAt) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", {
      formErrors: [],
      fieldErrors: { checkInAt: ["This day has no check-in yet, so it needs one"] },
    });
  }
  assertCorrectedTimes({
    checkInAt,
    checkOutAt,
    workDate,
    timezone,
    now,
    allowNextDayCheckIn: crossesMidnight(scheduledEndAt, workDate, timezone),
  });

  const office = data.siteId ? await findOffice(tenant, companyId, data.siteId) : null;
  const checkInSiteId = data.siteId === undefined ? record.checkInSiteId : data.siteId;
  const siteName = data.siteId === undefined ? (record.checkInSite?.name ?? null) : (office?.name ?? null);

  const outcome = computeCorrectedRecord({
    checkInAt,
    checkOutAt,
    autoClosedAt: record.autoClosedAt,
    scheduledStartAt,
    scheduledEndAt,
    lateGraceMinutes: schedule.lateGraceMinutes,
    flags: baseFlags,
  });

  const diff = diffFields(
    correctionFields({ ...record, siteName: record.checkInSite?.name ?? null }),
    correctionFields({ checkInAt, checkOutAt, status: outcome.status, siteName }),
    CORRECTED_FIELDS,
  );
  // Nothing happened, so nothing should say it did: no history, no "corrected" mark on
  // the record, and no notification.
  if (Object.keys(diff.after).length === 0 && checkInSiteId === record.checkInSiteId) throw nothingToCorrect();

  await tenant.$transaction(async (tx) => {
    // Conditional on the row being as this request read it, so an employee's check-out
    // or another HR correction a moment ago isn't silently overwritten.
    const { count } = await tx.attendanceRecord.updateMany({
      where: { companyId, id: record.id, updatedAt: record.updatedAt },
      data: {
        checkInAt,
        checkOutAt,
        ...outcome,
        scheduledStartAt,
        scheduledEndAt,
        checkInSiteId,
        isCorrected: true,
        // A row day close wrote stops being the system's once it has real times.
        ...(hadNoCheckIn ? { source: "HR" as const } : {}),
      },
    });
    if (count === 0) throw recordChanged();

    await tx.attendanceCorrection.create({
      data: {
        companyId,
        attendanceRecordId: record.id,
        correctedByUserId: actorUserId,
        reason: data.reason,
        before: diff.before as Prisma.InputJsonObject,
        after: diff.after as Prisma.InputJsonObject,
      },
    });
    await writeAudit(tx, {
      companyId,
      actorUserId,
      action: "ATTENDANCE_CORRECTED",
      entityType: "AttendanceRecord",
      entityId: record.id,
      metadata: { employeeId: record.employeeId, workDate, reason: data.reason, ...diff },
    });
    await notifyEmployee(tx, { companyId, employeeId: record.employeeId, recordId: record.id, workDate, reason: data.reason });
  });

  return toRecordWithCoordinatesDto(await tenant.attendanceRecord.findFirstOrThrow({ where: { companyId, id: record.id } }));
}

export async function createRecord(params: {
  companyId: string;
  actorUserId: string;
  actorEmployeeId: string | null;
  data: CreateAttendanceRequest;
}): Promise<AttendanceRecordWithCoordinatesDto> {
  const { companyId, actorUserId, actorEmployeeId, data } = params;
  const tenant = getTenantPrisma(companyId);
  const now = new Date();

  const employee = await tenant.employee.findFirst({ where: { companyId, id: data.employeeId }, select: { id: true, joiningDate: true } });
  if (!employee) throw new ApiError(404, "NOT_FOUND", "Employee not found.");
  if (actorEmployeeId !== null && employee.id === actorEmployeeId) throw cannotCorrectOwn();

  const exists = (recordId: string) =>
    new ApiError(409, "ATTENDANCE_RECORD_EXISTS", "This employee already has a record for that day. Correct it instead.", { recordId });
  const workDateValue = isoDateToUtcDate(data.workDate);
  const existing = await tenant.attendanceRecord.findFirst({ where: { companyId, employeeId: employee.id, workDate: workDateValue }, select: { id: true } });
  if (existing) throw exists(existing.id);

  // Not employed yet, so not a working day at all (§1.5).
  if (data.workDate < utcDateToIsoDate(employee.joiningDate)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", {
      formErrors: [],
      fieldErrors: { workDate: ["This is before the employee's joining date"] },
    });
  }

  const timezone = await getCompanyTimezone(companyId);
  const settingsRow = await tenant.companySettings.findUniqueOrThrow({ where: { companyId } });
  const settings = await getEmployeeScheduleSettings(tenant, settingsRow, employee.id);
  const schedule = await getScheduleForDate({ tenant, companyId, employeeId: employee.id, workDate: data.workDate, timezone, settings });

  const checkInAt = new Date(data.checkInAt);
  const checkOutAt = data.checkOutAt ? new Date(data.checkOutAt) : null;
  assertCorrectedTimes({
    checkInAt,
    checkOutAt,
    workDate: data.workDate,
    timezone,
    now,
    allowNextDayCheckIn: crossesMidnight(schedule.scheduledEndAt, data.workDate, timezone),
  });

  const office = data.siteId ? await findOffice(tenant, companyId, data.siteId) : null;
  const outcome = computeCorrectedRecord({
    checkInAt,
    checkOutAt,
    autoClosedAt: null,
    scheduledStartAt: schedule.scheduledStartAt,
    scheduledEndAt: schedule.scheduledEndAt,
    lateGraceMinutes: schedule.lateGraceMinutes,
    flags: getCheckInFlags(schedule),
  });

  try {
    const created = await tenant.$transaction(async (tx) => {
      const record = await tx.attendanceRecord.create({
        data: {
          companyId,
          employeeId: employee.id,
          workDate: workDateValue,
          checkInAt,
          checkOutAt,
          ...outcome,
          scheduledStartAt: schedule.scheduledStartAt,
          scheduledEndAt: schedule.scheduledEndAt,
          checkInSiteId: office?.id ?? null,
          source: "HR",
          isCorrected: true,
        },
      });

      // A visit past the close time with no row to link has been waiting for one (§1.6).
      await tx.siteVisit.updateMany({
        where: { companyId, employeeId: employee.id, workDate: workDateValue, attendanceRecordId: null },
        data: { attendanceRecordId: record.id },
      });

      const after = correctionFields({ checkInAt, checkOutAt, status: outcome.status, siteName: office?.name ?? null });
      await tx.attendanceCorrection.create({
        data: { companyId, attendanceRecordId: record.id, correctedByUserId: actorUserId, reason: data.reason, after: after as Prisma.InputJsonObject },
      });
      await writeAudit(tx, {
        companyId,
        actorUserId,
        action: "ATTENDANCE_CREATED_BY_HR",
        entityType: "AttendanceRecord",
        entityId: record.id,
        metadata: { employeeId: employee.id, workDate: data.workDate, reason: data.reason, after },
      });
      await notifyEmployee(tx, { companyId, employeeId: employee.id, recordId: record.id, workDate: data.workDate, reason: data.reason });
      return record;
    });
    return toRecordWithCoordinatesDto(created);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // The employee, or another HR user, got there first: the unique index makes this safe.
    const winner = await tenant.attendanceRecord.findFirstOrThrow({ where: { companyId, employeeId: employee.id, workDate: workDateValue }, select: { id: true } });
    throw exists(winner.id);
  }
}
