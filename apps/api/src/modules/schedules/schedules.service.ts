import { Prisma, type CompanySettings, type EmployeeSchedule } from "@prisma/client";
import {
  addDaysToIsoDate,
  isoDateToUtcDate,
  SCHEDULE_DAYS_AHEAD,
  todayInTimezone,
  utcDateToIsoDate,
  type EmployeeScheduleOverrideDto,
  type EmployeeScheduleResponse,
  type MyScheduleResponse,
  type Role,
  type ScheduleDayDto,
  type SetEmployeeScheduleRequest,
  type WeekSchedule,
  type WeeklyScheduleDto,
} from "@employee-saas/shared";
import { writeAudit } from "../../lib/audit.js";
import { diffFields } from "../../lib/auditDiff.js";
import { getCompanyTimezone } from "../../lib/companyTime.js";
import { ApiError } from "../../lib/errors.js";
import { getTenantPrisma, type TenantPrisma } from "../../lib/tenantPrisma.js";
import { getLeaveKindOnDate, resolveEffectiveSchedule, type ScheduleSettings } from "../attendance/attendance.rules.js";
import { getEmployeeScheduleSettings } from "../attendance/attendance.service.js";

const AUDITED_FIELDS = ["startTime", "endTime", "workingDays", "lateGraceMinutes"];

function toOverrideDto(row: EmployeeSchedule): EmployeeScheduleOverrideDto {
  return {
    startTime: row.startTime,
    endTime: row.endTime,
    workingDays: row.workingDays as WeekSchedule | null,
    lateGraceMinutes: row.lateGraceMinutes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toWeeklyDto(settings: ScheduleSettings, isOverride: boolean): WeeklyScheduleDto {
  return {
    source: isOverride ? "OVERRIDE" : "COMPANY",
    startTime: settings.workStartTime,
    endTime: settings.workEndTime,
    halfDayEndTime: settings.halfDayEndTime,
    lateGraceMinutes: settings.lateGraceMinutes,
    workingDays: settings.workingDays,
  };
}

function findOverride(tenant: TenantPrisma, companyId: string, employeeId: string) {
  return tenant.employeeSchedule.findFirst({ where: { companyId, employeeId } });
}

async function buildResponse(tenant: TenantPrisma, companySettings: CompanySettings, employeeId: string): Promise<EmployeeScheduleResponse> {
  const [override, settings] = await Promise.all([
    findOverride(tenant, companySettings.companyId, employeeId),
    getEmployeeScheduleSettings(tenant, companySettings, employeeId),
  ]);
  return { schedule: toWeeklyDto(settings, override !== null), override: override && toOverrideDto(override) };
}

/** The next 14 days at once, with one query each for holidays and leave rather than
 * two per day. Each day still goes through the same rule as a check-in. */
export async function getMySchedule(params: { companyId: string; employeeId: string }): Promise<MyScheduleResponse> {
  const { companyId, employeeId } = params;
  const tenant = getTenantPrisma(companyId);
  const [companySettings, timezone, override] = await Promise.all([
    tenant.companySettings.findUniqueOrThrow({ where: { companyId } }),
    getCompanyTimezone(companyId),
    findOverride(tenant, companyId, employeeId),
  ]);
  const settings = await getEmployeeScheduleSettings(tenant, companySettings, employeeId);

  const firstDay = todayInTimezone(timezone);
  const dates = Array.from({ length: SCHEDULE_DAYS_AHEAD }, (_, i) => addDaysToIsoDate(firstDay, i));
  const from = isoDateToUtcDate(dates[0]!);
  const to = isoDateToUtcDate(dates.at(-1)!);

  const [holidays, leaves] = await Promise.all([
    tenant.companyHoliday.findMany({ where: { companyId, date: { gte: from, lte: to } }, select: { date: true } }),
    tenant.leaveRequest.findMany({
      where: { companyId, employeeId, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } },
      select: { startDate: true, endDate: true, startHalfDay: true, endHalfDay: true },
    }),
  ]);
  const holidayDates = new Set(holidays.map((holiday) => utcDateToIsoDate(holiday.date)));
  const leaveRanges = leaves.map((leave) => ({
    ...leave,
    startDate: utcDateToIsoDate(leave.startDate),
    endDate: utcDateToIsoDate(leave.endDate),
  }));

  const days: ScheduleDayDto[] = dates.map((date) => {
    const leave = leaveRanges.find((range) => range.startDate <= date && date <= range.endDate);
    const day = resolveEffectiveSchedule({
      workDate: date,
      timezone,
      settings,
      isHoliday: holidayDates.has(date),
      leave: leave ? getLeaveKindOnDate(leave, date) : null,
    });
    return {
      date,
      dayType: day.dayType,
      isHalfDayLeave: day.isHalfDayLeave,
      scheduledStartAt: day.scheduledStartAt?.toISOString() ?? null,
      scheduledEndAt: day.scheduledEndAt?.toISOString() ?? null,
    };
  });

  return { schedule: toWeeklyDto(settings, override !== null), days };
}

/** Deny by default: anyone not named here, and a manager looking outside their team,
 * gets the same 404 as an employee who doesn't exist. */
export async function getEmployeeSchedule(params: {
  companyId: string;
  role: Role;
  callerEmployeeId: string | null;
  employeeId: string;
}): Promise<EmployeeScheduleResponse> {
  const { companyId, role, callerEmployeeId, employeeId } = params;
  const tenant = getTenantPrisma(companyId);
  const employee = await tenant.employee.findFirst({ where: { companyId, id: employeeId }, select: { managerId: true } });
  const isTheirManager = role === "MANAGER" && callerEmployeeId !== null && employee?.managerId === callerEmployeeId;
  if (!employee || !(role === "HR" || role === "COMPANY_ADMIN" || isTheirManager)) {
    throw new ApiError(404, "NOT_FOUND", "Employee not found.");
  }
  const companySettings = await tenant.companySettings.findUniqueOrThrow({ where: { companyId } });
  return buildResponse(tenant, companySettings, employeeId);
}

async function assertEmployeeExists(tenant: TenantPrisma, companyId: string, employeeId: string) {
  const employee = await tenant.employee.findFirst({ where: { companyId, id: employeeId }, select: { id: true } });
  if (!employee) throw new ApiError(404, "NOT_FOUND", "Employee not found.");
}

/** A schedule decides who counts as late, so nobody decides their own. */
function assertNotOwnSchedule(actorEmployeeId: string | null, employeeId: string) {
  if (actorEmployeeId === employeeId) {
    throw new ApiError(400, "CANNOT_SET_OWN_SCHEDULE", "You can't change your own schedule. Ask someone else in HR or a company admin.");
  }
}

export async function setEmployeeSchedule(params: {
  companyId: string;
  actorUserId: string;
  actorEmployeeId: string | null;
  employeeId: string;
  data: SetEmployeeScheduleRequest;
}): Promise<EmployeeScheduleResponse> {
  const { companyId, actorUserId, actorEmployeeId, employeeId, data } = params;
  assertNotOwnSchedule(actorEmployeeId, employeeId);
  const tenant = getTenantPrisma(companyId);
  await assertEmployeeExists(tenant, companyId, employeeId);

  // A field left out goes back to following the company: this replaces the override.
  const after = {
    startTime: data.startTime,
    endTime: data.endTime,
    workingDays: data.workingDays ?? null,
    lateGraceMinutes: data.lateGraceMinutes ?? null,
  };
  // Prisma needs DbNull to write SQL NULL into a JSON column.
  const columns = { ...after, workingDays: data.workingDays ?? Prisma.DbNull };

  await tenant.$transaction(async (tx) => {
    const existing = await tx.employeeSchedule.findFirst({ where: { companyId, employeeId } });
    const before = {
      startTime: existing?.startTime ?? null,
      endTime: existing?.endTime ?? null,
      workingDays: existing?.workingDays ?? null,
      lateGraceMinutes: existing?.lateGraceMinutes ?? null,
    };
    const diff = diffFields(before, after, AUDITED_FIELDS);
    // A save that changes nothing leaves no trace, like the other settings screens.
    if (existing && Object.keys(diff.after).length === 0) return;

    await tx.employeeSchedule.upsert({
      where: { companyId_employeeId: { companyId, employeeId } },
      create: { companyId, employeeId, ...columns },
      update: columns,
    });
    await writeAudit(tx, {
      companyId,
      actorUserId,
      action: "SCHEDULE_UPDATED",
      entityType: "Employee",
      entityId: employeeId,
      metadata: diff,
    });
  });

  const companySettings = await tenant.companySettings.findUniqueOrThrow({ where: { companyId } });
  return buildResponse(tenant, companySettings, employeeId);
}

/** Back to the company's hours. Past records keep their snapshot. */
export async function removeEmployeeSchedule(params: {
  companyId: string;
  actorUserId: string;
  actorEmployeeId: string | null;
  employeeId: string;
}): Promise<void> {
  const { companyId, actorUserId, actorEmployeeId, employeeId } = params;
  assertNotOwnSchedule(actorEmployeeId, employeeId);
  const tenant = getTenantPrisma(companyId);
  await assertEmployeeExists(tenant, companyId, employeeId);

  await tenant.$transaction(async (tx) => {
    const existing = await tx.employeeSchedule.findFirst({ where: { companyId, employeeId } });
    if (!existing) return;
    await tx.employeeSchedule.deleteMany({ where: { companyId, employeeId } });
    await writeAudit(tx, {
      companyId,
      actorUserId,
      action: "SCHEDULE_REMOVED",
      entityType: "Employee",
      entityId: employeeId,
      metadata: {
        before: {
          startTime: existing.startTime,
          endTime: existing.endTime,
          workingDays: existing.workingDays,
          lateGraceMinutes: existing.lateGraceMinutes,
        },
      },
    });
  });
}
