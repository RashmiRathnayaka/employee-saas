import type { Role } from "@employee-saas/shared";
import { ApiError } from "../../lib/errors.js";
import { platformPrisma } from "../../lib/prisma.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { writeAudit } from "../../lib/audit.js";
import { createNotification } from "../../lib/notifications.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";
import { getTodayInTimezone } from "../../lib/leaveDays.js";
import { lockOrCreateBalance, toUtcDate } from "./leaveRequests.service.js";

type Tenant = ReturnType<typeof getTenantPrisma>;

const PENDING_STATUSES = new Set(["PENDING_MANAGER", "PENDING_HR"]);

function balanceWhere(companyId: string, employeeId: string, leaveTypeId: string, year: number) {
  return { companyId_employeeId_leaveTypeId_year: { companyId, employeeId, leaveTypeId, year } };
}

export async function decideLeaveRequest(params: {
  companyId: string;
  actorUserId: string;
  actorRole: Role;
  actorEmployeeId: string | null;
  leaveRequestId: string;
  decision: "APPROVED" | "REJECTED";
  note?: string;
}) {
  const tenant: Tenant = getTenantPrisma(params.companyId);

  const leaveRequest = await tenant.leaveRequest.findUnique({
    where: { id: params.leaveRequestId },
    include: { employee: { include: { user: true } } },
  });
  if (!leaveRequest) {
    throw new ApiError(404, "NOT_FOUND", "Leave request not found.");
  }

  if (!PENDING_STATUSES.has(leaveRequest.status)) {
    throw new ApiError(409, "ALREADY_DECIDED", "This request has already been decided.");
  }

  if (leaveRequest.employeeId === params.actorEmployeeId) {
    throw new ApiError(403, "CANNOT_DECIDE_OWN_REQUEST", "You cannot decide your own leave request.");
  }

  const currentStep: "MANAGER" | "HR" = leaveRequest.status === "PENDING_MANAGER" ? "MANAGER" : "HR";
  let isHrFallback = false;

  if (currentStep === "MANAGER") {
    if (params.actorRole === "MANAGER") {
      if (leaveRequest.employee.managerId !== params.actorEmployeeId) {
        throw new ApiError(404, "NOT_FOUND", "Leave request not found.");
      }
    } else if (params.actorRole === "HR") {
      isHrFallback = true;
    } else {
      throw new ApiError(403, "FORBIDDEN", "You do not have permission to decide this request.");
    }
  } else if (params.actorRole !== "HR") {
    throw new ApiError(403, "FORBIDDEN", "Only HR can decide at this step.");
  }

  const settings = await tenant.companySettings.findUnique({ where: { companyId: params.companyId } });
  if (!settings) {
    throw new ApiError(500, "INTERNAL_ERROR", "Company settings not found.");
  }

  // HR deciding at the MANAGER step as a fallback is final, regardless of
  // workflow - routing it on to a (redundant) HR step would be circular.
  // See docs/architecture.md §3.
  const isFinalStep = currentStep === "HR" || isHrFallback || settings.leaveApprovalWorkflow === "MANAGER_ONLY";
  const year = leaveRequest.startDate.getUTCFullYear();

  return tenant.$transaction(async (tx) => {
    try {
      await tx.leaveApproval.create({
        data: {
          companyId: params.companyId,
          leaveRequestId: leaveRequest.id,
          step: currentStep,
          approverUserId: params.actorUserId,
          decision: params.decision,
          note: params.note,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiError(409, "ALREADY_DECIDED", "This step has already been decided.");
      }
      throw err;
    }

    await lockOrCreateBalance(tx, {
      companyId: params.companyId,
      employeeId: leaveRequest.employeeId,
      leaveTypeId: leaveRequest.leaveTypeId,
      year,
      defaultAllocatedDays: 0,
    });

    const where = balanceWhere(params.companyId, leaveRequest.employeeId, leaveRequest.leaveTypeId, year);
    let newStatus: "PENDING_HR" | "APPROVED" | "REJECTED";

    if (params.decision === "REJECTED") {
      newStatus = "REJECTED";
      await tx.leaveBalance.update({ where, data: { pendingDays: { decrement: leaveRequest.totalDays } } });
    } else if (isFinalStep) {
      newStatus = "APPROVED";
      await tx.leaveBalance.update({
        where,
        data: { pendingDays: { decrement: leaveRequest.totalDays }, usedDays: { increment: leaveRequest.totalDays } },
      });
    } else {
      newStatus = "PENDING_HR";
    }

    const updated = await tx.leaveRequest.update({ where: { id: leaveRequest.id }, data: { status: newStatus } });

    if (newStatus === "PENDING_HR") {
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
            title: "Leave request awaiting HR approval",
            body: "A manager-approved leave request now needs HR review.",
            relatedEntityType: "LeaveRequest",
            relatedEntityId: updated.id,
          }),
        ),
      );
    } else if (leaveRequest.employee.user) {
      await createNotification(tx, {
        companyId: params.companyId,
        userId: leaveRequest.employee.user.id,
        type: newStatus === "APPROVED" ? "LEAVE_REQUEST_APPROVED" : "LEAVE_REQUEST_REJECTED",
        title: newStatus === "APPROVED" ? "Your leave request was approved" : "Your leave request was rejected",
        body: `Your ${leaveRequest.totalDays}-day leave request is now ${newStatus.toLowerCase()}.`,
        relatedEntityType: "LeaveRequest",
        relatedEntityId: updated.id,
      });
    }

    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action:
        newStatus === "PENDING_HR"
          ? "LEAVE_REQUEST_MANAGER_APPROVED"
          : newStatus === "APPROVED"
            ? "LEAVE_REQUEST_APPROVED"
            : "LEAVE_REQUEST_REJECTED",
      entityType: "LeaveRequest",
      entityId: updated.id,
      metadata: { step: currentStep, decision: params.decision, isHrFallback },
    });

    return updated;
  });
}

export async function cancelLeaveRequest(params: {
  companyId: string;
  actorUserId: string;
  employeeId: string;
  leaveRequestId: string;
}) {
  const tenant: Tenant = getTenantPrisma(params.companyId);
  const leaveRequest = await tenant.leaveRequest.findUnique({ where: { id: params.leaveRequestId } });
  if (!leaveRequest || leaveRequest.employeeId !== params.employeeId) {
    throw new ApiError(404, "NOT_FOUND", "Leave request not found.");
  }
  if (!PENDING_STATUSES.has(leaveRequest.status)) {
    throw new ApiError(409, "ALREADY_DECIDED", "This request is no longer pending and cannot be cancelled.");
  }

  const year = leaveRequest.startDate.getUTCFullYear();

  return tenant.$transaction(async (tx) => {
    await lockOrCreateBalance(tx, {
      companyId: params.companyId,
      employeeId: leaveRequest.employeeId,
      leaveTypeId: leaveRequest.leaveTypeId,
      year,
      defaultAllocatedDays: 0,
    });

    await tx.leaveBalance.update({
      where: balanceWhere(params.companyId, leaveRequest.employeeId, leaveRequest.leaveTypeId, year),
      data: { pendingDays: { decrement: leaveRequest.totalDays } },
    });

    const updated = await tx.leaveRequest.update({ where: { id: leaveRequest.id }, data: { status: "CANCELLED" } });

    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "LEAVE_REQUEST_CANCELLED",
      entityType: "LeaveRequest",
      entityId: updated.id,
    });

    return updated;
  });
}

export async function revokeLeaveRequest(params: {
  companyId: string;
  actorUserId: string;
  leaveRequestId: string;
  note?: string;
}) {
  const tenant: Tenant = getTenantPrisma(params.companyId);
  const leaveRequest = await tenant.leaveRequest.findUnique({
    where: { id: params.leaveRequestId },
    include: { employee: { include: { user: true } } },
  });
  if (!leaveRequest) {
    throw new ApiError(404, "NOT_FOUND", "Leave request not found.");
  }
  if (leaveRequest.status !== "APPROVED") {
    throw new ApiError(409, "NOT_REVOCABLE", "Only an approved request can be revoked.");
  }

  const company = await platformPrisma.company.findUnique({ where: { id: params.companyId } });
  if (!company) {
    throw new ApiError(500, "INTERNAL_ERROR", "Company not found.");
  }
  const today = toUtcDate(getTodayInTimezone(company.timezone));
  if (leaveRequest.startDate.getTime() <= today.getTime()) {
    throw new ApiError(409, "NOT_REVOCABLE", "Only a future-dated approved request can be revoked.");
  }

  const year = leaveRequest.startDate.getUTCFullYear();

  return tenant.$transaction(async (tx) => {
    await lockOrCreateBalance(tx, {
      companyId: params.companyId,
      employeeId: leaveRequest.employeeId,
      leaveTypeId: leaveRequest.leaveTypeId,
      year,
      defaultAllocatedDays: 0,
    });

    // Revoke only ever touches usedDays - those days already left
    // pendingDays back when this request was approved, so there's nothing
    // left there for this request. See docs/architecture.md §3.
    await tx.leaveBalance.update({
      where: balanceWhere(params.companyId, leaveRequest.employeeId, leaveRequest.leaveTypeId, year),
      data: { usedDays: { decrement: leaveRequest.totalDays } },
    });

    const updated = await tx.leaveRequest.update({
      where: { id: leaveRequest.id },
      data: { status: "REVOKED", revokedById: params.actorUserId, revokedAt: new Date(), revokeNote: params.note },
    });

    if (leaveRequest.employee.user) {
      await createNotification(tx, {
        companyId: params.companyId,
        userId: leaveRequest.employee.user.id,
        type: "LEAVE_REQUEST_REVOKED",
        title: "Your approved leave was revoked",
        body: `Your ${leaveRequest.totalDays}-day leave request has been revoked.`,
        relatedEntityType: "LeaveRequest",
        relatedEntityId: updated.id,
      });
    }

    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "LEAVE_REQUEST_REVOKED",
      entityType: "LeaveRequest",
      entityId: updated.id,
      metadata: { note: params.note },
    });

    return updated;
  });
}
