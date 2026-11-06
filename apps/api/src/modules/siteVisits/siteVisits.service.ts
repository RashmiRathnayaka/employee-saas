import type { Prisma, Site } from "@prisma/client";
import {
  formatDate,
  formatTime,
  isModuleEnabled,
  isoDateToUtcDate,
  todayInTimezone,
  utcDateToIsoDate,
  type CorrectSiteVisitRequest,
  type LocationDto,
  type MySiteVisitsQuery,
  type OpenSiteVisitResponse,
  type PaginatedResponse,
  type Role,
  type SiteVisitDetailDto,
  type SiteVisitDto,
  type SiteVisitFlag,
  type SiteVisitListQuery,
  type SiteVisitWithCoordinatesDto,
} from "@employee-saas/shared";
import { writeAudit } from "../../lib/audit.js";
import { diffFields } from "../../lib/auditDiff.js";
import { getCompanyTimezone } from "../../lib/companyTime.js";
import { ApiError } from "../../lib/errors.js";
import { checkInColumns, evaluateCheckInLocation, toGpsSite } from "../../lib/gpsVerification.js";
import { createNotification, withNote } from "../../lib/notifications.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";
import { getTenantPrisma, type TenantPrisma } from "../../lib/tenantPrisma.js";
import { getCheckInFlags } from "../attendance/attendance.rules.js";
import { getCurrentDay, rejectCheckIn, startOfDayColumns, type CurrentDay } from "../attendance/attendance.service.js";
import { CORRECTION_INCLUDE, toCorrectionDto } from "../attendance/correctionRows.js";
import { assertCorrectedTimes, cannotCorrectOwn, nothingToCorrect, recordChanged } from "../attendance/correctionRules.js";
import {
  buildVisitCheckOut,
  findOpenVisit,
  toVisitDto,
  toVisitWithCoordinatesDto,
  VISIT_INCLUDE,
  type VisitRow,
} from "./siteVisitRows.js";
import { getVisitDayEffect } from "./siteVisits.rules.js";

function visitAlreadyOpen(visit: VisitRow) {
  return new ApiError(409, "VISIT_ALREADY_OPEN", `Check out of ${visit.site.name} first.`, {
    visit: { id: visit.id, siteName: visit.site.name },
  });
}

/** Employees can pick any active external site (Q5). An inactive or office site gets
 * the same 404 as one that doesn't exist, or belongs to another company. */
async function findPickableSite(tenant: TenantPrisma, companyId: string, siteId: string): Promise<Site> {
  const site = await tenant.site.findFirst({ where: { companyId, id: siteId, isActive: true, type: "EXTERNAL" } });
  if (!site) throw new ApiError(404, "NOT_FOUND", "Site not found.");
  return site;
}

/** The employee's manager gets told, if they can log in to see it (§1.6). HR isn't
 * notified, to avoid noise: they have the site report. */
async function notifyManager(
  tx: Pick<TenantPrisma, "employee" | "user" | "notification">,
  params: { companyId: string; employeeId: string; site: Site; visitId: string; now: Date; timezone: string },
) {
  const { companyId, employeeId, site, visitId, now, timezone } = params;
  const employee = await tx.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { firstName: true, lastName: true, managerId: true },
  });
  if (!employee.managerId) return;

  const manager = await tx.user.findFirst({ where: { companyId, employeeId: employee.managerId, status: "ACTIVE" }, select: { id: true } });
  if (!manager) return;

  await createNotification(tx, {
    companyId,
    userId: manager.id,
    type: "SITE_CHECKED_IN",
    title: "Site check-in",
    body: `${employee.firstName} ${employee.lastName} checked in at ${site.name}, ${formatTime(now.toISOString(), timezone)}`,
    relatedEntityType: "SiteVisit",
    relatedEntityId: visitId,
  });
}

export async function checkIn(params: {
  companyId: string;
  employeeId: string;
  userId: string;
  siteId: string;
  clientRequestId: string;
  location: LocationDto | null;
  note: string | null;
}): Promise<{ visit: SiteVisitWithCoordinatesDto; created: boolean }> {
  const { companyId, employeeId, userId, siteId, clientRequestId, location, note } = params;
  const tenant = getTenantPrisma(companyId);
  const now = new Date();

  const findRetried = () =>
    tenant.siteVisit.findFirst({ where: { companyId, employeeId, clientRequestId }, include: VISIT_INCLUDE });

  // Before anything else: a retry must get its visit back even if the site has since
  // been deactivated, or the employee has checked out.
  const retried = await findRetried();
  if (retried) return { visit: toVisitWithCoordinatesDto(retried), created: false };

  const site = await findPickableSite(tenant, companyId, siteId);

  const open = await findOpenVisit(tenant, { companyId, employeeId });
  if (open) throw visitAlreadyOpen(open);

  const settings = await tenant.companySettings.findUniqueOrThrow({ where: { companyId } });

  // A location sent for a site that doesn't require GPS stops here (Q6), and never
  // reaches a column.
  const gps = site.gpsRequired
    ? evaluateCheckInLocation({ site: toGpsSite(site), location, maxAccuracyM: settings.gpsMaxAccuracyMeters, now })
    : null;
  if (gps?.rejected) await rejectCheckIn(tenant, { companyId, userId, siteId: site.id, rejection: gps });
  const accepted = gps && !gps.rejected ? gps : null;

  const attendanceEnabled = isModuleEnabled(settings, "attendance");
  const timezone = await getCompanyTimezone(companyId);

  // Twice at most. If an office check-in wins the race for the day's row, the second
  // pass finds that row and only records the visit.
  for (let attempt = 0; ; attempt += 1) {
    const day: CurrentDay | null = attendanceEnabled ? await getCurrentDay({ tenant, companyId, employeeId, now }) : null;
    const effect = getVisitDayEffect({
      attendanceEnabled,
      nextAction: day?.nextAction ?? "CHECK_IN",
      record: day?.record ?? null,
    });
    const flags: SiteVisitFlag[] = [...effect.flags, ...(accepted?.flags ?? [])];

    try {
      const visit = await tenant.$transaction(async (tx) => {
        const started =
          effect.startsDay && day
            ? await tx.attendanceRecord.create({
                data: {
                  companyId,
                  employeeId,
                  ...startOfDayColumns({ workDate: day.workDate, schedule: day.schedule, now }),
                  flags: getCheckInFlags(day.schedule),
                  source: "SITE_VISIT",
                },
              })
            : null;

        const created = await tx.siteVisit.create({
          data: {
            companyId,
            employeeId,
            siteId: site.id,
            attendanceRecordId: started?.id ?? effect.linkedRecordId,
            workDate: isoDateToUtcDate(day?.workDate ?? todayInTimezone(timezone, now)),
            status: "OPEN",
            checkInAt: now,
            ...(accepted ? checkInColumns(accepted.reading) : {}),
            flags,
            note,
            clientRequestId,
          },
          include: VISIT_INCLUDE,
        });

        await notifyManager(tx, { companyId, employeeId, site, visitId: created.id, now, timezone });
        return created;
      });
      return { visit: toVisitWithCoordinatesDto(visit), created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Another request got there first. The unique indexes are what make this safe:
      // both can pass the checks above, but only one insert can succeed.
      const sameTap = await findRetried();
      if (sameTap) return { visit: toVisitWithCoordinatesDto(sameTap), created: false };
      const nowOpen = await findOpenVisit(tenant, { companyId, employeeId });
      if (nowOpen) throw visitAlreadyOpen(nowOpen);
      if (attempt >= 1) throw err;
    }
  }
}

export async function checkOut(params: {
  companyId: string;
  employeeId: string;
  visitId: string;
  location: LocationDto | null;
  note: string | null;
}): Promise<SiteVisitWithCoordinatesDto> {
  const { companyId, employeeId, visitId, location, note } = params;
  const tenant = getTenantPrisma(companyId);
  const now = new Date();

  // Only the owner: anyone else gets the same 404 as a visit that doesn't exist.
  const visit = await tenant.siteVisit.findFirst({ where: { companyId, id: visitId, employeeId }, include: VISIT_INCLUDE });
  if (!visit) throw new ApiError(404, "NOT_FOUND", "Site visit not found.");

  const notOpen = () => new ApiError(409, "VISIT_NOT_OPEN", "This visit is already closed.");
  if (visit.status !== "OPEN") throw notOpen();

  const settings = await tenant.companySettings.findUniqueOrThrow({ where: { companyId } });

  // Conditional, so a double tap or a day check-out at the same moment can't both write.
  const { count } = await tenant.siteVisit.updateMany({
    where: { companyId, id: visit.id, status: "OPEN" },
    data: {
      ...buildVisitCheckOut({ visit, location, maxAccuracyM: settings.gpsMaxAccuracyMeters, now, verifyGps: true }),
      // Added to what was written at check-in, which is worth keeping.
      ...(note ? { note: visit.note ? `${visit.note}\n${note}` : note } : {}),
    },
  });
  if (count === 0) throw notOpen();

  return toVisitWithCoordinatesDto(await tenant.siteVisit.findFirstOrThrow({ where: { companyId, id: visit.id }, include: VISIT_INCLUDE }));
}

export async function getMyOpenVisit(params: { companyId: string; employeeId: string }): Promise<OpenSiteVisitResponse> {
  const visit = await findOpenVisit(getTenantPrisma(params.companyId), params);
  return { visit: visit && toVisitWithCoordinatesDto(visit), gpsRequired: visit?.site.gpsRequired ?? false };
}

function workDateFilter(from: string | undefined, to: string | undefined): Prisma.SiteVisitWhereInput {
  if (!from && !to) return {};
  return { workDate: { ...(from ? { gte: isoDateToUtcDate(from) } : {}), ...(to ? { lte: isoDateToUtcDate(to) } : {}) } };
}

async function listPage<T>(
  tenant: TenantPrisma,
  where: Prisma.SiteVisitWhereInput,
  page: number,
  pageSize: number,
  toDto: (visit: VisitRow) => T,
): Promise<PaginatedResponse<T>> {
  const [rows, total] = await Promise.all([
    tenant.siteVisit.findMany({
      where,
      include: VISIT_INCLUDE,
      orderBy: { checkInAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    tenant.siteVisit.count({ where }),
  ]);
  return { data: rows.map(toDto), page, pageSize, total };
}

export function listMyVisits(params: {
  companyId: string;
  employeeId: string;
  query: MySiteVisitsQuery;
}): Promise<PaginatedResponse<SiteVisitWithCoordinatesDto>> {
  const { companyId, employeeId, query } = params;
  const where = { companyId, employeeId, ...workDateFilter(query.from, query.to) };
  return listPage(getTenantPrisma(companyId), where, query.page, query.pageSize, toVisitWithCoordinatesDto);
}

function listFilters(companyId: string, query: SiteVisitListQuery): Prisma.SiteVisitWhereInput {
  return {
    companyId,
    ...workDateFilter(query.from, query.to),
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.siteId ? { siteId: query.siteId } : {}),
    ...(query.openOnly ? { status: "OPEN" as const } : {}),
  };
}

/** Direct reports only. An `employeeId` outside the team just finds nothing. Lists
 * never carry coordinates, for anyone. */
export function listTeamVisits(params: {
  companyId: string;
  managerEmployeeId: string;
  query: SiteVisitListQuery;
}): Promise<PaginatedResponse<SiteVisitDto>> {
  const { companyId, managerEmployeeId, query } = params;
  const where = { ...listFilters(companyId, query), employee: { managerId: managerEmployeeId } };
  return listPage(getTenantPrisma(companyId), where, query.page, query.pageSize, toVisitDto);
}

export function listAllVisits(params: { companyId: string; query: SiteVisitListQuery }): Promise<PaginatedResponse<SiteVisitDto>> {
  const { companyId, query } = params;
  return listPage(getTenantPrisma(companyId), listFilters(companyId, query), query.page, query.pageSize, toVisitDto);
}

/** Deny by default: anyone not named here gets the same 404 as a visit that doesn't
 * exist, so they can't tell it's there. */
export async function getVisit(params: {
  companyId: string;
  role: Role;
  callerEmployeeId: string | null;
  visitId: string;
}): Promise<SiteVisitDetailDto> {
  const { companyId, role, callerEmployeeId, visitId } = params;
  const visit = await getTenantPrisma(companyId).siteVisit.findFirst({
    where: { companyId, id: visitId },
    include: {
      ...VISIT_INCLUDE,
      employee: { select: { ...VISIT_INCLUDE.employee.select, managerId: true } },
      corrections: { include: CORRECTION_INCLUDE, orderBy: { createdAt: "desc" } },
    },
  });
  const notFound = new ApiError(404, "NOT_FOUND", "Site visit not found.");
  if (!visit) throw notFound;
  const corrections = visit.corrections.map(toCorrectionDto);

  const isOwner = callerEmployeeId !== null && visit.employeeId === callerEmployeeId;
  if (isOwner || role === "HR" || role === "COMPANY_ADMIN") return { visit: toVisitWithCoordinatesDto(visit), corrections };

  const isTheirManager = role === "MANAGER" && callerEmployeeId !== null && visit.employee.managerId === callerEmployeeId;
  if (isTheirManager) return { visit: toVisitDto(visit), corrections };

  throw notFound;
}

/**
 * HR's correction of a visit's times (§1.7). The visit's flags and its attendance
 * record are left as they are: the flags say what happened at the time, and the record
 * has its own correction. Setting a check-out closes an open or auto-closed visit.
 */
export async function correctVisit(params: {
  companyId: string;
  actorUserId: string;
  actorEmployeeId: string | null;
  visitId: string;
  data: CorrectSiteVisitRequest;
}): Promise<SiteVisitWithCoordinatesDto> {
  const { companyId, actorUserId, actorEmployeeId, visitId, data } = params;
  const tenant = getTenantPrisma(companyId);
  const now = new Date();

  const visit = await tenant.siteVisit.findFirst({ where: { companyId, id: visitId }, include: VISIT_INCLUDE });
  if (!visit) throw new ApiError(404, "NOT_FOUND", "Site visit not found.");
  if (actorEmployeeId !== null && visit.employeeId === actorEmployeeId) throw cannotCorrectOwn();

  const timezone = await getCompanyTimezone(companyId);
  const workDate = utcDateToIsoDate(visit.workDate);
  const checkInAt = data.checkInAt ? new Date(data.checkInAt) : visit.checkInAt;
  const checkOutAt = data.checkOutAt ? new Date(data.checkOutAt) : visit.checkOutAt;
  // A night worker's visit can start after midnight, and a visit doesn't record which
  // kind of shift it belonged to.
  assertCorrectedTimes({ checkInAt, checkOutAt, workDate, timezone, now, allowNextDayCheckIn: true });

  const status = checkOutAt ? ("CLOSED" as const) : visit.status;
  const fields = (row: { checkInAt: Date; checkOutAt: Date | null; status: string }) => ({
    checkInAt: row.checkInAt.toISOString(),
    checkOutAt: row.checkOutAt?.toISOString() ?? null,
    status: row.status,
  });
  const diff = diffFields(fields(visit), fields({ checkInAt, checkOutAt, status }), ["checkInAt", "checkOutAt", "status"]);
  if (Object.keys(diff.after).length === 0) throw nothingToCorrect();

  await tenant.$transaction(async (tx) => {
    // Conditional on the row being as this request read it, so the employee's own
    // check-out a moment ago isn't silently overwritten.
    const { count } = await tx.siteVisit.updateMany({
      where: { companyId, id: visit.id, updatedAt: visit.updatedAt },
      data: {
        checkInAt,
        checkOutAt,
        status,
        durationMinutes: checkOutAt ? Math.floor((checkOutAt.getTime() - checkInAt.getTime()) / 60_000) : null,
        isCorrected: true,
      },
    });
    if (count === 0) throw recordChanged();

    await tx.attendanceCorrection.create({
      data: {
        companyId,
        siteVisitId: visit.id,
        correctedByUserId: actorUserId,
        reason: data.reason,
        before: diff.before as Prisma.InputJsonObject,
        after: diff.after as Prisma.InputJsonObject,
      },
    });
    await writeAudit(tx, {
      companyId,
      actorUserId,
      action: "SITE_VISIT_CORRECTED",
      entityType: "SiteVisit",
      entityId: visit.id,
      metadata: { employeeId: visit.employeeId, siteId: visit.siteId, workDate, reason: data.reason, ...diff },
    });

    const login = await tx.user.findFirst({ where: { companyId, employeeId: visit.employeeId, status: "ACTIVE" }, select: { id: true } });
    if (login) {
      await createNotification(tx, {
        companyId,
        userId: login.id,
        type: "ATTENDANCE_CORRECTED",
        title: "Site visit corrected",
        body: withNote(`HR corrected your visit to ${visit.site.name} on ${formatDate(workDate)}.`, data.reason, "Reason"),
        relatedEntityType: "SiteVisit",
        relatedEntityId: visit.id,
      });
    }
  });

  return toVisitWithCoordinatesDto(await tenant.siteVisit.findFirstOrThrow({ where: { companyId, id: visit.id }, include: VISIT_INCLUDE }));
}
