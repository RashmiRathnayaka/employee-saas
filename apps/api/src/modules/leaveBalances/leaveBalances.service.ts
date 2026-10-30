import type { Role } from "@employee-saas/shared";
import { ApiError } from "../../lib/errors.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { writeAudit } from "../../lib/audit.js";

function currentYear(): number {
  return new Date().getUTCFullYear();
}

export async function getBalancesForEmployee(params: {
  companyId: string;
  employeeId: string;
  requesterRole: Role;
  requesterEmployeeId: string | null;
}) {
  const tenant = getTenantPrisma(params.companyId);

  if (params.requesterRole === "EMPLOYEE" && params.employeeId !== params.requesterEmployeeId) {
    throw new ApiError(404, "NOT_FOUND", "Employee not found.");
  }

  const employee = await tenant.employee.findUnique({ where: { id: params.employeeId } });
  if (!employee) {
    throw new ApiError(404, "NOT_FOUND", "Employee not found.");
  }

  if (
    params.requesterRole === "MANAGER" &&
    employee.id !== params.requesterEmployeeId &&
    employee.managerId !== params.requesterEmployeeId
  ) {
    throw new ApiError(404, "NOT_FOUND", "Employee not found.");
  }

  const balances = await tenant.leaveBalance.findMany({
    where: { employeeId: params.employeeId, year: currentYear() },
  });
  return balances;
}

export async function adjustBalance(params: {
  companyId: string;
  actorUserId: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  allocatedDays?: number;
  usedDays?: number;
  carriedOverDays?: number;
  note: string;
}) {
  const tenant = getTenantPrisma(params.companyId);

  const employee = await tenant.employee.findUnique({ where: { id: params.employeeId } });
  if (!employee) {
    throw new ApiError(404, "NOT_FOUND", "Employee not found.");
  }

  const existing = await tenant.leaveBalance.findUnique({
    where: {
      companyId_employeeId_leaveTypeId_year: {
        companyId: params.companyId,
        employeeId: params.employeeId,
        leaveTypeId: params.leaveTypeId,
        year: params.year,
      },
    },
  });
  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Leave balance not found for that leave type/year.");
  }

  const nextUsedDays = params.usedDays ?? existing.usedDays.toNumber();
  if (nextUsedDays < 0) {
    throw new ApiError(400, "INVALID_ADJUSTMENT", "usedDays cannot be negative.");
  }

  return tenant.$transaction(async (tx) => {
    const updated = await tx.leaveBalance.update({
      where: { id: existing.id },
      data: {
        allocatedDays: params.allocatedDays,
        usedDays: params.usedDays,
        carriedOverDays: params.carriedOverDays,
      },
    });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "LEAVE_BALANCE_ADJUSTED",
      entityType: "LeaveBalance",
      entityId: existing.id,
      metadata: {
        note: params.note,
        before: {
          allocatedDays: existing.allocatedDays.toNumber(),
          usedDays: existing.usedDays.toNumber(),
          carriedOverDays: existing.carriedOverDays.toNumber(),
        },
        after: {
          allocatedDays: updated.allocatedDays.toNumber(),
          usedDays: updated.usedDays.toNumber(),
          carriedOverDays: updated.carriedOverDays.toNumber(),
        },
      },
    });
    return updated;
  });
}
