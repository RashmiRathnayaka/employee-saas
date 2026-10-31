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
  data: Record<string, unknown>;
}) {
  const tenant = getTenantPrisma(params.companyId);
  return tenant.$transaction(async (tx) => {
    const updated = await tx.companySettings.update({ where: { companyId: params.companyId }, data: params.data });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "COMPANY_SETTINGS_UPDATED",
      entityType: "CompanySettings",
      entityId: params.companyId,
      metadata: params.data,
    });
    return updated;
  });
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
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "HOLIDAY_DELETED",
      entityType: "CompanyHoliday",
      entityId: params.holidayId,
    });
  });
}
