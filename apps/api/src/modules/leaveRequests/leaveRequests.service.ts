import type { Role } from "@employee-saas/shared";
import type { LeaveBalance, Prisma } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { platformPrisma } from "../../lib/prisma.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { writeAudit } from "../../lib/audit.js";
import { createNotification } from "../../lib/notifications.js";
import { calculateLeaveDays, getTodayInTimezone, normalizeWorkingDays } from "../../lib/leaveDays.js";

type Tenant = ReturnType<typeof getTenantPrisma>;
// Deliberately loose - see the comment on lib/audit.ts's AuditClient for
// why (an extended-client transaction's type doesn't structurally match
// Prisma's own Prisma.TransactionClient type). This function touches too
// many models/operations to hand-write a precise structural type the way
// lib/audit.ts and lib/notifications.ts do for their single method.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

const PAST_DATE_WINDOW_DAYS = 30;

function toUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

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

async function notifyApprovers(
  tx: Tx,
  params: { companyId: string; employee: { id: string; firstName: string; lastName: string; managerId: string | null }; leaveRequestId: string; totalDays: number; routedToHr: boolean },
) {
  const body = `${params.employee.firstName} ${params.employee.lastName} requested ${params.totalDays} day(s) of leave.`;

  if (!params.routedToHr && params.employee.managerId) {
    const manager = await tx.employee.findUnique({ where: { id: params.employee.managerId }, include: { user: true } });
    if (manager?.user) {
      await createNotification(tx, {
        companyId: params.companyId,
        userId: manager.user.id,
        type: "LEAVE_REQUEST_SUBMITTED",
        title: "New leave request awaiting your approval",
        body,
        relatedEntityType: "LeaveRequest",
        relatedEntityId: params.leaveRequestId,
      });
    }
    return;
  }

  const hrUsers: { id: string }[] = await tx.user.findMany({
    where: { companyId: params.companyId, role: "HR", status: "ACTIVE" },
    select: { id: true },
  });
  await Promise.all(
    hrUsers.map((hr) =>
      createNotification(tx, {
        companyId: params.companyId,
        userId: hr.id,
        type: "LEAVE_REQUEST_SUBMITTED",
        title: "New leave request awaiting HR approval",
        body,
        relatedEntityType: "LeaveRequest",
        relatedEntityId: params.leaveRequestId,
      }),
    ),
  );
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

  const today = toUtcDate(getTodayInTimezone(company.timezone));
  if (startDate.getTime() < today.getTime()) {
    if (!leaveType.allowPastDates) {
      throw new ApiError(400, "PAST_DATE_NOT_ALLOWED", "This leave type cannot be submitted for a past date.");
    }
    const daysAgo = Math.round((today.getTime() - startDate.getTime()) / 86_400_000);
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
    ? new Date(startDate.getTime() + settings.sickLeaveProofDeadlineDays * 86_400_000)
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
      employee,
      leaveRequestId: created.id,
      totalDays,
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

export async function listTeamLeaveRequests(params: {
  companyId: string;
  managerEmployeeId: string;
  page: number;
  pageSize: number;
  status?: string;
  employeeId?: string;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const where: Prisma.LeaveRequestWhereInput = { employee: { managerId: params.managerEmployeeId } };
  if (params.status) where.status = params.status as Prisma.LeaveRequestWhereInput["status"];
  // Narrows within the manager's own team - never widens access beyond it.
  if (params.employeeId) where.employeeId = params.employeeId;
  return paginateRequests(tenant, where, params.page, params.pageSize);
}

export async function listAllLeaveRequests(params: {
  companyId: string;
  page: number;
  pageSize: number;
  status?: string;
  employeeId?: string;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const where: Prisma.LeaveRequestWhereInput = {};
  if (params.status) where.status = params.status as Prisma.LeaveRequestWhereInput["status"];
  if (params.employeeId) where.employeeId = params.employeeId;
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

export { lockOrCreateBalance, toUtcDate };
