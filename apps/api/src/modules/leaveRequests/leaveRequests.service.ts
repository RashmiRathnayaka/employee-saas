import { addDaysToIsoDate, daysBetweenIsoDates, isoDateToUtcDate, todayInTimezone, utcDateToIsoDate, type Role } from "@employee-saas/shared";
import type { LeaveBalance, Prisma } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { platformPrisma } from "../../lib/prisma.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { writeAudit } from "../../lib/audit.js";
import { createNotification, findActiveHrUserIds, leaveRangeText, notifyUsers } from "../../lib/notifications.js";
import { calculateLeaveDays, normalizeWorkingDays } from "../../lib/leaveDays.js";

type Tenant = ReturnType<typeof getTenantPrisma>;
// Deliberately loose - see the comment on lib/audit.ts's AuditClient for
// why (an extended-client transaction's type doesn't structurally match
// Prisma's own Prisma.TransactionClient type). This function touches too
// many models/operations to hand-write a precise structural type the way
// lib/audit.ts and lib/notifications.ts do for their single method.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

const PAST_DATE_WINDOW_DAYS = 30;

const toUtcDate = isoDateToUtcDate;
const dateKey = utcDateToIsoDate;

/** Locks the balance row for the duration of the transaction (creating it
 * first, from the leave type's default, if it's missing - the normal path
 * is that employee/leave-type creation already seeded it; see
 * docs/architecture.md §3). */
async function lockOrCreateBalance(
  tx: Tx,
  params: { companyId: string; employeeId: string; leaveTypeId: string; year: number; defaultAllocatedDays: number },
): Promise<LeaveBalance> {
  const existing = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM leave_balances
    WHERE "companyId" = ${params.companyId} AND "employeeId" = ${params.employeeId}
      AND "leaveTypeId" = ${params.leaveTypeId} AND "year" = ${params.year}
    FOR UPDATE
  `;

  if (existing.length === 0) {
    await tx.leaveBalance.create({
      data: {
        companyId: params.companyId,
        employeeId: params.employeeId,
        leaveTypeId: params.leaveTypeId,
        year: params.year,
        allocatedDays: params.defaultAllocatedDays,
      },
    });
  }

  return tx.leaveBalance.findUniqueOrThrow({
    where: {
      companyId_employeeId_leaveTypeId_year: {
        companyId: params.companyId,
        employeeId: params.employeeId,
        leaveTypeId: params.leaveTypeId,
        year: params.year,
      },
    },
  });
}

/** Notifies whoever must act on a newly submitted request: the employee's
 * manager, or HR when the request went straight to PENDING_HR (no
 * manager) - and also HR when the manager has no active login, since
 * nobody would see it otherwise and HR can decide at the MANAGER step as a
 * fallback (docs/architecture.md §3). Never notifies the requester. */
async function notifyApprovers(
  tx: Tx,
  params: {
    companyId: string;
    requesterUserId: string;
    employee: { id: string; firstName: string; lastName: string; managerId: string | null };
    leaveRequestId: string;
    totalDays: number;
    startDate: Date;
    endDate: Date;
    routedToHr: boolean;
  },
) {
  const body = `${params.employee.firstName} ${params.employee.lastName} requested ${params.totalDays} day(s) of leave (${leaveRangeText(params.startDate, params.endDate)}).`;
  const related = { relatedEntityType: "LeaveRequest" as const, relatedEntityId: params.leaveRequestId };

  if (!params.routedToHr && params.employee.managerId) {
    const manager = await tx.employee.findUnique({ where: { id: params.employee.managerId }, include: { user: true } });
    if (manager?.user && manager.user.status === "ACTIVE" && manager.user.id !== params.requesterUserId) {
      await createNotification(tx, {
        companyId: params.companyId,
        userId: manager.user.id,
        type: "LEAVE_REQUEST_SUBMITTED",
        title: "New leave request awaiting your approval",
        body,
        ...related,
      });
      return;
    }
  }

  const hrUserIds = await findActiveHrUserIds(tx, { companyId: params.companyId, excludeUserId: params.requesterUserId });
  await notifyUsers(tx, hrUserIds, {
    companyId: params.companyId,
    type: "LEAVE_REQUEST_SUBMITTED",
    title: "New leave request awaiting HR approval",
    body,
    ...related,
  });
}

/** Computes totalDays for a candidate date range without creating anything
 * or touching balances - backs the "show total days before submitting" UI.
 * Deliberately doesn't duplicate submit-time checks like past-dates or
 * overlap (those depend on the chosen leave type and existing requests);
 * this is just the day-count arithmetic. */
export async function previewLeaveDays(params: {
  companyId: string;
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
}): Promise<number> {
  const tenant = getTenantPrisma(params.companyId);
  const settings = await tenant.companySettings.findUnique({ where: { companyId: params.companyId } });
  if (!settings) throw new ApiError(500, "INTERNAL_ERROR", "Company configuration not found.");

  const startDate = toUtcDate(params.startDate);
  const endDate = toUtcDate(params.endDate);
  if (startDate.getUTCFullYear() !== endDate.getUTCFullYear()) {
    throw new ApiError(400, "INVALID_LEAVE_RANGE", "A leave request must stay within a single calendar year.");
  }

  const holidayRows = await tenant.companyHoliday.findMany({
    where: { companyId: params.companyId, date: { gte: startDate, lte: endDate } },
  });
  const holidays = new Set(holidayRows.map((h) => dateKey(h.date)));

  return calculateLeaveDays({
    startDate,
    endDate,
    startHalfDay: params.startHalfDay,
    endHalfDay: params.endHalfDay,
    workingDays: normalizeWorkingDays(settings.workingDays),
    holidays,
  });
}

export async function submitLeaveRequest(params: {
  companyId: string;
  employeeId: string;
  actorUserId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
  reason?: string;
}) {
  const tenant = getTenantPrisma(params.companyId);

  const [employee, leaveType, settings, company] = await Promise.all([
    tenant.employee.findUnique({ where: { id: params.employeeId } }),
    tenant.leaveType.findUnique({ where: { id: params.leaveTypeId } }),
    tenant.companySettings.findUnique({ where: { companyId: params.companyId } }),
    platformPrisma.company.findUnique({ where: { id: params.companyId } }),
  ]);
  if (!employee) throw new ApiError(404, "NOT_FOUND", "Employee not found.");
  if (!leaveType) throw new ApiError(404, "NOT_FOUND", "Leave type not found.");
  if (!settings || !company) throw new ApiError(500, "INTERNAL_ERROR", "Company configuration not found.");

  const startDate = toUtcDate(params.startDate);
  const endDate = toUtcDate(params.endDate);

  if (startDate.getUTCFullYear() !== endDate.getUTCFullYear()) {
    throw new ApiError(400, "INVALID_LEAVE_RANGE", "A leave request must stay within a single calendar year.");
  }
  const year = startDate.getUTCFullYear();

  // "Today" is the company's calendar day, not the server's (see lib/companyTime.ts).
  const todayIso = todayInTimezone(company.timezone);
  const daysAgo = daysBetweenIsoDates(params.startDate, todayIso);
  if (daysAgo > 0) {
    if (!leaveType.allowPastDates) {
      throw new ApiError(400, "PAST_DATE_NOT_ALLOWED", "This leave type cannot be submitted for a past date.");
    }
    if (daysAgo > PAST_DATE_WINDOW_DAYS) {
      throw new ApiError(
        400,
        "PAST_DATE_TOO_OLD",
        `This leave type allows past dates only up to ${PAST_DATE_WINDOW_DAYS} days back.`,
      );
    }
  }

  const overlapping = await tenant.leaveRequest.findFirst({
    where: {
      employeeId: params.employeeId,
      status: { in: ["PENDING_MANAGER", "PENDING_HR", "APPROVED"] },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
  });
  if (overlapping) {
    throw new ApiError(
      409,
      "LEAVE_OVERLAP",
      "This date range overlaps with an existing pending or approved leave request.",
    );
  }

  const holidayRows = await tenant.companyHoliday.findMany({
    where: { companyId: params.companyId, date: { gte: startDate, lte: endDate } },
  });
  const holidays = new Set(holidayRows.map((h) => dateKey(h.date)));

  const totalDays = calculateLeaveDays({
    startDate,
    endDate,
    startHalfDay: params.startHalfDay,
    endHalfDay: params.endHalfDay,
    workingDays: normalizeWorkingDays(settings.workingDays),
    holidays,
  });

  const routedToHr = !employee.managerId;
  const initialStatus = routedToHr ? "PENDING_HR" : "PENDING_MANAGER";
  const proofStatus = leaveType.requiresProof ? "MISSING" : "NOT_REQUIRED";
  const proofDueAt = leaveType.requiresProof
    ? toUtcDate(addDaysToIsoDate(params.startDate, settings.sickLeaveProofDeadlineDays))
    : null;

  return tenant.$transaction(async (tx) => {
    const balance = await lockOrCreateBalance(tx, {
      companyId: params.companyId,
      employeeId: params.employeeId,
      leaveTypeId: params.leaveTypeId,
      year,
      defaultAllocatedDays: leaveType.defaultAnnualDays.toNumber(),
    });

    const available =
      balance.allocatedDays.toNumber() +
      balance.carriedOverDays.toNumber() -
      balance.usedDays.toNumber() -
      balance.pendingDays.toNumber();
    if (available < totalDays) {
      throw new ApiError(
        409,
        "INSUFFICIENT_BALANCE",
        `Insufficient leave balance: ${available} day(s) available, ${totalDays} requested.`,
      );
    }

    await tx.leaveBalance.update({ where: { id: balance.id }, data: { pendingDays: { increment: totalDays } } });

    const created = await tx.leaveRequest.create({
      data: {
        companyId: params.companyId,
        employeeId: params.employeeId,
        leaveTypeId: params.leaveTypeId,
        startDate,
        endDate,
        startHalfDay: params.startHalfDay,
        endHalfDay: params.endHalfDay,
        totalDays,
        reason: params.reason,
        status: initialStatus,
        proofStatus,
        proofDueAt,
      },
    });

    await notifyApprovers(tx, {
      companyId: params.companyId,
      requesterUserId: params.actorUserId,
      employee,
      leaveRequestId: created.id,
      totalDays,
      startDate,
      endDate,
      routedToHr,
    });

    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "LEAVE_REQUEST_SUBMITTED",
      entityType: "LeaveRequest",
      entityId: created.id,
      metadata: { leaveTypeId: params.leaveTypeId, totalDays, startDate: params.startDate, endDate: params.endDate },
    });

    return created;
  });
}

export async function listOwnLeaveRequests(params: {
  companyId: string;
  employeeId: string;
  page: number;
  pageSize: number;
  status?: string;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const where: Prisma.LeaveRequestWhereInput = { employeeId: params.employeeId };
  if (params.status) where.status = params.status as Prisma.LeaveRequestWhereInput["status"];
  return paginateRequests(tenant, where, params.page, params.pageSize);
}

type LeaveRequestListFilters = {
  status?: string;
  employeeId?: string;
  leaveTypeId?: string;
  fromDate?: string;
  toDate?: string;
  proofOverdue?: boolean;
};

function applyListFilters(where: Prisma.LeaveRequestWhereInput, params: LeaveRequestListFilters) {
  if (params.status) where.status = params.status as Prisma.LeaveRequestWhereInput["status"];
  if (params.employeeId) where.employeeId = params.employeeId;
  if (params.leaveTypeId) where.leaveTypeId = params.leaveTypeId;
  if (params.fromDate) where.endDate = { gte: toUtcDate(params.fromDate) };
  if (params.toDate) where.startDate = { lte: toUtcDate(params.toDate) };
  if (params.proofOverdue) where.proofStatus = { in: ["MISSING", "INFO_REQUIRED"] };
}

export async function listTeamLeaveRequests(
  params: { companyId: string; managerEmployeeId: string; page: number; pageSize: number } & LeaveRequestListFilters,
) {
  const tenant = getTenantPrisma(params.companyId);
  // Narrowed within the manager's own team - the extra filters below only
  // ever restrict further, never widen access beyond direct reports.
  const where: Prisma.LeaveRequestWhereInput = { employee: { managerId: params.managerEmployeeId } };
  applyListFilters(where, params);
  return paginateRequests(tenant, where, params.page, params.pageSize);
}

export async function listAllLeaveRequests(
  params: { companyId: string; page: number; pageSize: number } & LeaveRequestListFilters,
) {
  const tenant = getTenantPrisma(params.companyId);
  const where: Prisma.LeaveRequestWhereInput = {};
  applyListFilters(where, params);
  return paginateRequests(tenant, where, params.page, params.pageSize);
}

async function paginateRequests(
  tenant: Tenant,
  where: Prisma.LeaveRequestWhereInput,
  page: number,
  pageSize: number,
) {
  const skip = (page - 1) * pageSize;
  const [data, total] = await Promise.all([
    tenant.leaveRequest.findMany({ where, skip, take: pageSize, orderBy: { createdAt: "desc" } }),
    tenant.leaveRequest.count({ where }),
  ]);
  return { data, total };
}

export async function getLeaveRequestById(params: {
  companyId: string;
  leaveRequestId: string;
  requesterRole: Role;
  requesterEmployeeId: string | null;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const leaveRequest = await tenant.leaveRequest.findUnique({
    where: { id: params.leaveRequestId },
    include: { employee: true },
  });
  if (!leaveRequest) {
    throw new ApiError(404, "NOT_FOUND", "Leave request not found.");
  }

  const isOwner = leaveRequest.employeeId === params.requesterEmployeeId;
  const isManagerOfOwner =
    params.requesterRole === "MANAGER" && leaveRequest.employee.managerId === params.requesterEmployeeId;
  const isAdminOrHr = params.requesterRole === "COMPANY_ADMIN" || params.requesterRole === "HR";

  if (!isOwner && !isManagerOfOwner && !isAdminOrHr) {
    throw new ApiError(404, "NOT_FOUND", "Leave request not found.");
  }

  return leaveRequest;
}

export async function getApprovalHistory(params: { companyId: string; leaveRequestId: string }) {
  const tenant = getTenantPrisma(params.companyId);
  return tenant.leaveApproval.findMany({
    where: { leaveRequestId: params.leaveRequestId },
    orderBy: { decidedAt: "asc" },
    include: { approver: { select: { id: true, email: true, role: true } } },
  });
}

export { lockOrCreateBalance, toUtcDate };
