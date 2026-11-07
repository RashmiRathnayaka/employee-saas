import { isModuleEnabled, isValidShiftLength, SHIFT_LENGTH_MESSAGE, type UpdateCompanySettingsRequest } from "@employee-saas/shared";
import { syncAttendanceWithHoliday } from "../attendance/attendanceHooks.js";
import { diffFields } from "../../lib/auditDiff.js";
import { invalidateEnabledModulesCache } from "../../lib/enabledModules.js";
import { ApiError } from "../../lib/errors.js";
import { platformPrisma } from "../../lib/prisma.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { writeAudit } from "../../lib/audit.js";

export async function getOwnCompany(companyId: string) {
  const company = await platformPrisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    throw new ApiError(404, "NOT_FOUND", "Company not found.");
  }
  return company;
}

export async function updateOwnCompany(params: {
  companyId: string;
  actorUserId: string;
  data: { name?: string; logoUrl?: string | null; primaryColor?: string | null };
}) {
  return platformPrisma.$transaction(async (tx) => {
    const updated = await tx.company.update({ where: { id: params.companyId }, data: params.data });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "COMPANY_PROFILE_UPDATED",
      entityType: "Company",
      entityId: params.companyId,
      metadata: params.data,
    });
    return updated;
  });
}

export async function getOwnSettings(companyId: string) {
  const tenant = getTenantPrisma(companyId);
  const settings = await tenant.companySettings.findUnique({ where: { companyId } });
  if (!settings) {
    throw new ApiError(404, "NOT_FOUND", "Company settings not found.");
  }
  return settings;
}

export async function updateOwnSettings(params: {
  companyId: string;
  actorUserId: string;
  data: UpdateCompanySettingsRequest;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const updated = await tenant.$transaction(async (tx) => {
    const existing = await tx.companySettings.findUnique({ where: { companyId: params.companyId } });
    if (!existing) {
      throw new ApiError(404, "NOT_FOUND", "Company settings not found.");
    }

    // Only when the PATCH touches the shift, so an unrelated save can't be
    // blocked by what's stored. Sent alone, one end is judged against the
    // stored other end, which the request schema can't see.
    const { workStartTime, workEndTime } = params.data;
    if (
      (workStartTime !== undefined || workEndTime !== undefined) &&
      !isValidShiftLength(workStartTime ?? existing.workStartTime, workEndTime ?? existing.workEndTime)
    ) {
      const field = workEndTime !== undefined ? "workEndTime" : "workStartTime";
      throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", {
        formErrors: [],
        fieldErrors: { [field]: [SHIFT_LENGTH_MESSAGE] },
      });
    }

    const data: Record<string, unknown> = { ...params.data };
    if (params.data.enabledModules) {
      // Merge, so turning one module on can't turn the others off.
      data.enabledModules = { ...(existing.enabledModules as Record<string, unknown>), ...params.data.enabledModules };
    }

    // Day close only marks days that started after this: before it, nobody could check in.
    const attendanceTurnedOn = params.data.enabledModules?.attendance === true && !isModuleEnabled(existing, "attendance");

    const saved = await tx.companySettings.update({
      where: { companyId: params.companyId },
      data: { ...data, ...(attendanceTurnedOn ? { attendanceEnabledAt: new Date() } : {}) },
    });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "COMPANY_SETTINGS_UPDATED",
      entityType: "CompanySettings",
      entityId: params.companyId,
      metadata: diffFields(existing, saved, Object.keys(data)),
    });
    return saved;
  });

  invalidateEnabledModulesCache(params.companyId);
  return updated;
}

export async function listHolidays(companyId: string) {
  const tenant = getTenantPrisma(companyId);
  return tenant.companyHoliday.findMany({ where: { companyId }, orderBy: { date: "asc" } });
}

export async function createHoliday(params: { companyId: string; actorUserId: string; date: string; name: string }) {
  const tenant = getTenantPrisma(params.companyId);
  const date = new Date(params.date);

  const existing = await tenant.companyHoliday.findFirst({ where: { companyId: params.companyId, date } });
  if (existing) {
    throw new ApiError(409, "HOLIDAY_ALREADY_EXISTS", "A holiday is already defined for this date.");
  }

  return tenant.$transaction(async (tx) => {
    const holiday = await tx.companyHoliday.create({ data: { companyId: params.companyId, date, name: params.name } });
    await syncAttendanceWithHoliday(tx, { companyId: params.companyId, date });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "HOLIDAY_CREATED",
      entityType: "CompanyHoliday",
      entityId: holiday.id,
      metadata: { date: params.date, name: params.name },
    });
    return holiday;
  });
}

export async function deleteHoliday(params: { companyId: string; actorUserId: string; holidayId: string }) {
  const tenant = getTenantPrisma(params.companyId);
  const holiday = await tenant.companyHoliday.findUnique({ where: { id: params.holidayId } });
  if (!holiday) {
    throw new ApiError(404, "NOT_FOUND", "Holiday not found.");
  }

  await tenant.$transaction(async (tx) => {
    await tx.companyHoliday.delete({ where: { id: params.holidayId } });
    await syncAttendanceWithHoliday(tx, { companyId: params.companyId, date: holiday.date });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "HOLIDAY_DELETED",
      entityType: "CompanyHoliday",
      entityId: params.holidayId,
    });
  });
}
