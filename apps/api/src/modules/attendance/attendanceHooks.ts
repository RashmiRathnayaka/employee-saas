import { utcDateToIsoDate } from "@employee-saas/shared";
import type { TenantPrisma } from "../../lib/tenantPrisma.js";
import { getLeaveKindOnDate } from "./attendance.rules.js";
import { closeRecord, reconcileNoCheckInRows } from "./attendanceRows.js";

/**
 * What other modules' decisions do to attendance: database-schema-phase2, "Cross-module
 * effects". Each runs inside the decision's own transaction, so the two can't disagree.
 * They don't check whether the attendance module is on: past rows should be right
 * whichever way that switch is now, and with no rows they do nothing.
 */

type HookTx = Pick<TenantPrisma, "attendanceRecord" | "siteVisit" | "companyHoliday" | "leaveRequest">;

const LEAVE_FLAGS = ["ON_APPROVED_LEAVE", "HALF_DAY_LEAVE"];

/**
 * After a leave is approved, revoked or cancelled. A day with no check-in flips between
 * `ABSENT` and `ON_LEAVE`. A day with a check-in only gains or loses the flag: the person
 * did come in, and the times stand.
 */
export async function syncAttendanceWithLeave(
  tx: HookTx,
  params: { companyId: string; employeeId: string; startDate: Date; endDate: Date },
): Promise<void> {
  const { companyId, employeeId, startDate, endDate } = params;
  const range = { gte: startDate, lte: endDate };

  await reconcileNoCheckInRows(tx, { companyId, employeeId, from: startDate, to: endDate });

  const checkedIn = await tx.attendanceRecord.findMany({
    where: { companyId, employeeId, workDate: range, checkInAt: { not: null } },
    select: { id: true, workDate: true, flags: true },
  });
  if (checkedIn.length === 0) return;

  const leaves = await tx.leaveRequest.findMany({
    where: { companyId, employeeId, status: "APPROVED", startDate: { lte: endDate }, endDate: { gte: startDate } },
    select: { startDate: true, endDate: true, startHalfDay: true, endHalfDay: true },
  });

  for (const row of checkedIn) {
    // A day off doesn't use up leave, so a check-in on one stays what it was (§1.5).
    if (row.flags.includes("NON_WORKING_DAY")) continue;
    const leave = leaves.find((request) => request.startDate <= row.workDate && request.endDate >= row.workDate);
    const kind =
      leave && getLeaveKindOnDate({ ...leave, startDate: utcDateToIsoDate(leave.startDate), endDate: utcDateToIsoDate(leave.endDate) }, utcDateToIsoDate(row.workDate));
    const leaveFlag = kind === "FULL" ? ["ON_APPROVED_LEAVE"] : kind === "HALF" ? ["HALF_DAY_LEAVE"] : [];
    const flags = [...row.flags.filter((flag) => !LEAVE_FLAGS.includes(flag)), ...leaveFlag];
    if (flags.length !== row.flags.length || flags.some((flag) => !row.flags.includes(flag))) {
      await tx.attendanceRecord.updateMany({ where: { companyId, id: row.id }, data: { flags } });
    }
  }
}

/** After a holiday is added or deleted, for that date, for everyone. */
export function syncAttendanceWithHoliday(tx: HookTx, params: { companyId: string; date: Date }): Promise<void> {
  return reconcileNoCheckInRows(tx, { companyId: params.companyId, from: params.date, to: params.date });
}

/**
 * When someone is deactivated, nothing of theirs stays open (§1.5). It uses the same
 * closing code as the job, with no wait for a close time, and every open visit goes too,
 * linked or not. No notification: their login is being deactivated in this same
 * transaction, and "ask HR" wouldn't make sense.
 */
export async function closeOpenWorkOfEmployee(
  tx: Pick<TenantPrisma, "attendanceRecord" | "siteVisit">,
  params: { companyId: string; employeeId: string; now: Date },
): Promise<{ closedRecords: number; closedVisits: number }> {
  const { companyId, employeeId, now } = params;
  const records = await tx.attendanceRecord.findMany({
    where: { companyId, employeeId, checkInAt: { not: null }, checkOutAt: null, autoClosedAt: null },
    select: { id: true, flags: true },
  });

  let closedRecords = 0;
  let closedVisits = 0;
  for (const record of records) {
    const closed = await closeRecord(tx, { companyId, record, now });
    if (!closed) continue;
    closedRecords += 1;
    closedVisits += closed.closedVisitSiteNames.length;
  }
  const others = await tx.siteVisit.updateMany({ where: { companyId, employeeId, status: "OPEN" }, data: { status: "AUTO_CLOSED" } });
  return { closedRecords, closedVisits: closedVisits + others.count };
}
