import type { Site } from "@prisma/client";
import {
  getSiteLocationErrors,
  type CreateSiteRequest,
  type PaginatedResponse,
  type Role,
  type SiteDto,
  type SiteListQuery,
  type SiteSummaryDto,
  type UpdateSiteRequest,
} from "@employee-saas/shared";
import { diffFields } from "../../lib/auditDiff.js";
import { writeAudit } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import { isForeignKeyViolation, isUniqueViolation } from "../../lib/prismaErrors.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";

/** Deny by default: only these roles see coordinates and inactive sites. */
function canManageSites(role: Role): boolean {
  return role === "COMPANY_ADMIN" || role === "HR";
}

/** Prisma returns DECIMAL columns as Decimal objects, which JSON would turn into
 * strings. These are positions rather than money, so a number is the right type. */
function toSiteDto(site: Site): SiteDto {
  return {
    id: site.id,
    name: site.name,
    type: site.type,
    address: site.address,
    latitude: site.latitude === null ? null : site.latitude.toNumber(),
    longitude: site.longitude === null ? null : site.longitude.toNumber(),
    radiusMeters: site.radiusMeters,
    gpsRequired: site.gpsRequired,
    isActive: site.isActive,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  };
}

function toSiteSummaryDto(site: Site): SiteSummaryDto {
  return {
    id: site.id,
    name: site.name,
    type: site.type,
    address: site.address,
    gpsRequired: site.gpsRequired,
    radiusMeters: site.radiusMeters,
    hasCoordinates: site.latitude !== null && site.longitude !== null,
  };
}

function nameTaken() {
  return new ApiError(409, "SITE_NAME_TAKEN", "A site with this name already exists.");
}

function assertValidLocation(site: { latitude: number | null; longitude: number | null; gpsRequired: boolean }) {
  const fieldErrors = getSiteLocationErrors(site);
  if (Object.keys(fieldErrors).length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", { formErrors: [], fieldErrors });
  }
}

export async function listSites(params: {
  companyId: string;
  role: Role;
  query: SiteListQuery;
}): Promise<PaginatedResponse<SiteDto | SiteSummaryDto>> {
  const { page, pageSize, type, active, q } = params.query;
  const managing = canManageSites(params.role);
  const tenant = getTenantPrisma(params.companyId);

  const where = {
    companyId: params.companyId,
    ...(type ? { type } : {}),
    // Everyone else only ever sees active sites, whatever they ask for.
    ...(managing ? (active === undefined ? {} : { isActive: active }) : { isActive: true }),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { address: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    tenant.site.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    tenant.site.count({ where }),
  ]);

  return { data: rows.map((site) => (managing ? toSiteDto(site) : toSiteSummaryDto(site))), page, pageSize, total };
}

export async function getSite(params: {
  companyId: string;
  role: Role;
  siteId: string;
}): Promise<SiteDto | SiteSummaryDto> {
  const site = await getTenantPrisma(params.companyId).site.findUnique({ where: { id: params.siteId } });
  const managing = canManageSites(params.role);
  if (!site || (!managing && !site.isActive)) {
    throw new ApiError(404, "NOT_FOUND", "Site not found.");
  }
  return managing ? toSiteDto(site) : toSiteSummaryDto(site);
}

export async function createSite(params: {
  companyId: string;
  actorUserId: string;
  data: CreateSiteRequest;
}): Promise<SiteDto> {
  const tenant = getTenantPrisma(params.companyId);
  const { data } = params;

  const defaults = await tenant.companySettings.findUniqueOrThrow({
    where: { companyId: params.companyId },
    select: { gpsRadiusMeters: true, gpsCheckinEnabledDefault: true },
  });
  const latitude = data.latitude ?? null;
  const longitude = data.longitude ?? null;
  const radiusMeters = data.radiusMeters ?? defaults.gpsRadiusMeters;
  const gpsRequired = data.gpsRequired ?? defaults.gpsCheckinEnabledDefault;
  assertValidLocation({ latitude, longitude, gpsRequired });

  const duplicate = await tenant.site.findFirst({
    where: { companyId: params.companyId, name: { equals: data.name, mode: "insensitive" } },
  });
  if (duplicate) throw nameTaken();

  try {
    const site = await tenant.$transaction(async (tx) => {
      const created = await tx.site.create({
        data: {
          companyId: params.companyId,
          createdByUserId: params.actorUserId,
          name: data.name,
          type: data.type,
          address: data.address ?? null,
          latitude,
          longitude,
          radiusMeters,
          gpsRequired,
        },
      });
      await writeAudit(tx, {
        companyId: params.companyId,
        actorUserId: params.actorUserId,
        action: "SITE_CREATED",
        entityType: "Site",
        entityId: created.id,
        metadata: { name: created.name, type: created.type },
      });
      return created;
    });
    return toSiteDto(site);
  } catch (err) {
    // Two requests can both pass the check above. The unique index stops the second.
    if (isUniqueViolation(err)) throw nameTaken();
    throw err;
  }
}

const EDITABLE_FIELDS = ["name", "type", "address", "latitude", "longitude", "radiusMeters", "gpsRequired"];

export async function updateSite(params: {
  companyId: string;
  actorUserId: string;
  siteId: string;
  data: UpdateSiteRequest;
}): Promise<SiteDto> {
  const tenant = getTenantPrisma(params.companyId);
  const existing = await tenant.site.findUnique({ where: { id: params.siteId } });
  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Site not found.");
  }
  const before = toSiteDto(existing);

  // A partial edit is judged on what the site will look like afterwards.
  const after = {
    ...before,
    ...Object.fromEntries(Object.entries(params.data).filter(([, value]) => value !== undefined)),
  } as SiteDto;
  assertValidLocation(after);

  if (after.name.toLowerCase() !== before.name.toLowerCase()) {
    const duplicate = await tenant.site.findFirst({
      where: {
        companyId: params.companyId,
        name: { equals: after.name, mode: "insensitive" },
        id: { not: params.siteId },
      },
    });
    if (duplicate) throw nameTaken();
  }

  const changes = diffFields(before, after, EDITABLE_FIELDS);
  if (Object.keys(changes.after).length === 0) {
    return before;
  }

  try {
    const site = await tenant.$transaction(async (tx) => {
      const updated = await tx.site.update({
        where: { id: params.siteId },
        data: {
          name: after.name,
          type: after.type,
          address: after.address,
          latitude: after.latitude,
          longitude: after.longitude,
          radiusMeters: after.radiusMeters,
          gpsRequired: after.gpsRequired,
        },
      });
      await writeAudit(tx, {
        companyId: params.companyId,
        actorUserId: params.actorUserId,
        action: "SITE_UPDATED",
        entityType: "Site",
        entityId: params.siteId,
        metadata: changes,
      });
      return updated;
    });
    return toSiteDto(site);
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken();
    throw err;
  }
}

export async function setSiteActive(params: {
  companyId: string;
  actorUserId: string;
  siteId: string;
  isActive: boolean;
}): Promise<SiteDto> {
  const tenant = getTenantPrisma(params.companyId);
  const existing = await tenant.site.findUnique({ where: { id: params.siteId } });
  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Site not found.");
  }
  if (existing.isActive === params.isActive) {
    return toSiteDto(existing);
  }

  const site = await tenant.$transaction(async (tx) => {
    const updated = await tx.site.update({ where: { id: params.siteId }, data: { isActive: params.isActive } });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "SITE_STATUS_CHANGED",
      entityType: "Site",
      entityId: params.siteId,
      metadata: { before: { isActive: existing.isActive }, after: { isActive: params.isActive } },
    });
    return updated;
  });
  return toSiteDto(site);
}

export async function deleteSite(params: { companyId: string; actorUserId: string; siteId: string }): Promise<void> {
  const tenant = getTenantPrisma(params.companyId);
  const existing = await tenant.site.findUnique({ where: { id: params.siteId } });
  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Site not found.");
  }

  try {
    await tenant.$transaction(async (tx) => {
      await tx.site.delete({ where: { id: params.siteId } });
      await writeAudit(tx, {
        companyId: params.companyId,
        actorUserId: params.actorUserId,
        action: "SITE_DELETED",
        entityType: "Site",
        entityId: params.siteId,
        metadata: { name: existing.name },
      });
    });
  } catch (err) {
    // Attendance records, visits and tasks reference sites with ON DELETE
    // RESTRICT, so the database is what decides "in use", and a table added by
    // a later step is covered without changing this code.
    if (isForeignKeyViolation(err)) {
      throw new ApiError(409, "SITE_IN_USE", "This site is in use and can't be deleted. Deactivate it instead.");
    }
    throw err;
  }
}
