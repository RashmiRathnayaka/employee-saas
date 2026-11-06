import type { Prisma } from "@prisma/client";
import { utcDateToIsoDate, type LocationDto, type SiteVisitDto, type SiteVisitFlag, type SiteVisitWithCoordinatesDto } from "@employee-saas/shared";
import { checkOutColumns, evaluateCheckOutLocation, toGpsSite } from "../../lib/gpsVerification.js";
import type { TenantPrisma } from "../../lib/tenantPrisma.js";

/**
 * Reading and closing visit rows. It's separate from the service because a day
 * check-out closes a visit too, and the site visit service already depends on the
 * attendance service: this file keeps that one-way.
 */

const ONE_MINUTE_MS = 60_000;

export const VISIT_INCLUDE = {
  employee: { select: { firstName: true, lastName: true, employeeCode: true } },
  site: true,
} satisfies Prisma.SiteVisitInclude;

export type VisitRow = Prisma.SiteVisitGetPayload<{ include: typeof VISIT_INCLUDE }>;

/** Built from a fixed list of fields rather than by removing some from the row, so a
 * column added later can't reach a manager by default. */
export function toVisitDto(visit: VisitRow): SiteVisitDto {
  return {
    id: visit.id,
    employeeId: visit.employeeId,
    employeeName: `${visit.employee.firstName} ${visit.employee.lastName}`,
    employeeCode: visit.employee.employeeCode,
    siteId: visit.siteId,
    siteName: visit.site.name,
    attendanceRecordId: visit.attendanceRecordId,
    workDate: utcDateToIsoDate(visit.workDate),
    status: visit.status,
    checkInAt: visit.checkInAt.toISOString(),
    checkOutAt: visit.checkOutAt?.toISOString() ?? null,
    durationMinutes: visit.durationMinutes,
    checkInAccuracyM: visit.checkInAccuracyM,
    checkInDistanceM: visit.checkInDistanceM,
    checkInWithinRadius: visit.checkInWithinRadius,
    checkInMocked: visit.checkInMocked,
    checkOutAccuracyM: visit.checkOutAccuracyM,
    checkOutDistanceM: visit.checkOutDistanceM,
    checkOutWithinRadius: visit.checkOutWithinRadius,
    checkOutMocked: visit.checkOutMocked,
    flags: visit.flags as SiteVisitFlag[],
    note: visit.note,
    isCorrected: visit.isCorrected,
    createdAt: visit.createdAt.toISOString(),
    updatedAt: visit.updatedAt.toISOString(),
  };
}

export function toVisitWithCoordinatesDto(visit: VisitRow): SiteVisitWithCoordinatesDto {
  return {
    ...toVisitDto(visit),
    checkInLat: visit.checkInLat?.toNumber() ?? null,
    checkInLng: visit.checkInLng?.toNumber() ?? null,
    checkOutLat: visit.checkOutLat?.toNumber() ?? null,
    checkOutLng: visit.checkOutLng?.toNumber() ?? null,
  };
}

/** At most one, thanks to the partial unique index. */
export function findOpenVisit(tenant: TenantPrisma, params: { companyId: string; employeeId: string }): Promise<VisitRow | null> {
  return tenant.siteVisit.findFirst({
    where: { companyId: params.companyId, employeeId: params.employeeId, status: "OPEN" },
    include: VISIT_INCLUDE,
  });
}

/**
 * What a check-out writes to a visit, from either check-out button. The site decides
 * whether the location is looked at, using its settings as they are now. Problems
 * only add flags, and a location for a site that doesn't require GPS isn't kept (Q6).
 */
export function buildVisitCheckOut(params: {
  visit: VisitRow;
  location: LocationDto | null;
  maxAccuracyM: number;
  now: Date;
  /** False with the `sites` module off: nothing is checked and no position is kept. */
  verifyGps: boolean;
}) {
  const { visit, location, maxAccuracyM, now, verifyGps } = params;
  // The database requires check-out after check-in, and two API servers' clocks can
  // differ slightly.
  const checkOutAt = now > visit.checkInAt ? now : new Date(visit.checkInAt.getTime() + 1);
  const gps =
    verifyGps && visit.site.gpsRequired
      ? evaluateCheckOutLocation({ site: toGpsSite(visit.site), location, maxAccuracyM, now })
      : null;

  return {
    status: "CLOSED" as const,
    checkOutAt,
    durationMinutes: Math.floor((checkOutAt.getTime() - visit.checkInAt.getTime()) / ONE_MINUTE_MS),
    // Check-in may already have set the same flag, such as a low accuracy.
    flags: [...new Set([...visit.flags, ...(gps?.flags ?? [])])],
    ...(gps?.reading ? checkOutColumns(gps.reading) : {}),
  };
}
