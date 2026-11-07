import { isoDateToUtcDate, utcDateToIsoDate } from "@employee-saas/shared";
import type { TenantPrisma } from "../../lib/tenantPrisma.js";
import { getLeaveKindOnDate } from "./attendance.rules.js";
import { getAutoCloseColumns, getNoCheckInOutcome, toAbsentDayVisitFlags } from "./dayClose.rules.js";

/**
 * Writing to attendance rows that day close or a later decision owns. Everything here
 * takes a transaction client or the tenant client, and every write is conditional, so
 * it's safe to run twice or alongside a check-out.
 */

type Rows = Pick<TenantPrisma, "attendanceRecord" | "siteVisit">;

/**
 * Closes one forgotten record, and any open visit linked to it. Other open visits aren't
 * this record's: after a worker outage, closing yesterday's record mustn't end the visit
 * someone is on today. Those have their own rule.
 *
 * Returns the sites whose visits closed, or null if the record was no longer open, such
 * as when the employee checked out a moment ago.
 */
export async function closeRecord(
  tx: Rows,
  params: { companyId: string; record: { id: string; flags: string[] }; now: Date },
): Promise<{ closedVisitSiteNames: string[] } | null> {
  const { companyId, record, now } = params;
  const { count } = await tx.attendanceRecord.updateMany({
    where: { companyId, id: record.id, checkOutAt: null, autoClosedAt: null },
    data: getAutoCloseColumns(record.flags, now),
  });
  if (count === 0) return null;

  const visits = await tx.siteVisit.findMany({
    where: { companyId, attendanceRecordId: record.id, status: "OPEN" },
    select: { id: true, site: { select: { name: true } } },
  });
  await tx.siteVisit.updateMany({ where: { companyId, id: { in: visits.map((visit) => visit.id) }, status: "OPEN" }, data: { status: "AUTO_CLOSED" } });
  return { closedVisitSiteNames: visits.map((visit) => visit.site.name) };
}

/**
 * Brings the no-check-in rows of a date range in line with today's holidays and approved
 * leave. Deciding from those facts, rather than flipping one way or the other, makes it
 * safe to call from every hook and to repeat.
 *
 * Only rows with no check-in change: HR's corrections have one, and a person's real
 * times aren't overruled by a calendar.
 */
export async function reconcileNoCheckInRows(
  tx: Pick<TenantPrisma, "attendanceRecord" | "siteVisit" | "companyHoliday" | "leaveRequest">,
  params: { companyId: string; from: Date; to: Date; employeeId?: string },
): Promise<void> {
  const { companyId, from, to, employeeId } = params;
  const employeeFilter = employeeId ? { employeeId } : {};

  const rows = await tx.attendanceRecord.findMany({
    where: { companyId, ...employeeFilter, checkInAt: null, workDate: { gte: from, lte: to } },
    select: { id: true, employeeId: true, workDate: true, status: true, flags: true, scheduledStartAt: true, scheduledEndAt: true },
  });
  if (rows.length === 0) return;

  const [holidays, leaves] = await Promise.all([
    tx.companyHoliday.findMany({ where: { companyId, date: { gte: from, lte: to } }, select: { date: true } }),
    tx.leaveRequest.findMany({
      where: { companyId, ...employeeFilter, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } },
      select: { employeeId: true, startDate: true, endDate: true, startHalfDay: true, endHalfDay: true },
    }),
  ]);
  const holidayDates = new Set(holidays.map((holiday) => utcDateToIsoDate(holiday.date)));

  // Grouped by what they become, so a holiday over a big company is a few statements
  // and not one per person, which could outlast the transaction's time limit.
  const changes = new Map<string, { ids: string[]; data: Record<string, unknown> }>();
  const nowAbsent: string[] = [];

  for (const row of rows) {
    const workDate = utcDateToIsoDate(row.workDate);
    const leave = leaves
      .filter((request) => request.employeeId === row.employeeId && request.startDate <= row.workDate && request.endDate >= row.workDate)
      .map((request) => getLeaveKindOnDate({ ...request, startDate: utcDateToIsoDate(request.startDate), endDate: utcDateToIsoDate(request.endDate) }, workDate))[0];
    const outcome = getNoCheckInOutcome({ isHoliday: holidayDates.has(workDate), leave: leave ?? null });

    const flags = [...row.flags.filter((flag) => flag !== "HALF_DAY_LEAVE"), ...outcome.flags];
    const sameFlags = flags.length === row.flags.length && flags.every((flag) => row.flags.includes(flag));
    if (outcome.status === row.status && sameFlags) continue;

    // A holiday has no schedule. Without this, an HR correction of the day would judge
    // the check-in against a shift that wasn't on (§1.7).
    const clearsSnapshot = outcome.status === "HOLIDAY" && (row.scheduledStartAt !== null || row.scheduledEndAt !== null);
    const key = JSON.stringify([outcome.status, flags, clearsSnapshot]);
    const group = changes.get(key) ?? {
      ids: [],
      data: { status: outcome.status, flags, ...(clearsSnapshot ? { scheduledStartAt: null, scheduledEndAt: null } : {}) },
    };
    group.ids.push(row.id);
    changes.set(key, group);
    if (outcome.status === "ABSENT") nowAbsent.push(row.id);
  }

  for (const { ids, data } of changes.values()) {
    await tx.attendanceRecord.updateMany({ where: { companyId, id: { in: ids }, checkInAt: null }, data });
  }

  // A visit on a day that was ON_LEAVE or HOLIDAY is only AFTER_HOURS. Now that the day
  // is ABSENT, it's the contradiction HR must see (§1.6). A visit already flagged
  // ON_ABSENT_DAY keeps the flag whatever the row becomes, as a record of what happened.
  if (nowAbsent.length > 0) {
    const visits = await tx.siteVisit.findMany({
      where: { companyId, attendanceRecordId: { in: nowAbsent }, flags: { has: "AFTER_HOURS" } },
      select: { id: true, flags: true },
    });
    for (const visit of visits) {
      await tx.siteVisit.updateMany({ where: { companyId, id: visit.id }, data: { flags: toAbsentDayVisitFlags(visit.flags) } });
    }
  }
}

/**
 * Links visits that were waiting for a row: made past the close time, before day close
 * wrote one (§1.6). On `ABSENT` the flag becomes `ON_ABSENT_DAY`. On `ON_LEAVE` or
 * `HOLIDAY` it stays `AFTER_HOURS`, the same as a visit made after the row existed.
 */
export async function linkWaitingVisits(tenant: Rows, params: { companyId: string; workDate: string }): Promise<void> {
  const { companyId } = params;
  const workDate = isoDateToUtcDate(params.workDate);

  const visits = await tenant.siteVisit.findMany({
    where: { companyId, workDate, attendanceRecordId: null },
    select: { id: true, employeeId: true, flags: true },
  });
  if (visits.length === 0) return;

  const rows = await tenant.attendanceRecord.findMany({
    where: { companyId, workDate, checkInAt: null, employeeId: { in: visits.map((visit) => visit.employeeId) } },
    select: { id: true, employeeId: true, status: true },
  });
  const rowByEmployee = new Map(rows.map((row) => [row.employeeId, row]));

  for (const visit of visits) {
    const row = rowByEmployee.get(visit.employeeId);
    if (!row) continue;
    await tenant.siteVisit.updateMany({
      where: { companyId, id: visit.id, attendanceRecordId: null },
      data: { attendanceRecordId: row.id, ...(row.status === "ABSENT" ? { flags: toAbsentDayVisitFlags(visit.flags) } : {}) },
    });
  }
}
