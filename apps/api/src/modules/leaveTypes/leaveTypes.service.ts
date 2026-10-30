import { ApiError } from "../../lib/errors.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { writeAudit } from "../../lib/audit.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";

export async function listLeaveTypes(companyId: string) {
  const tenant = getTenantPrisma(companyId);
  return tenant.leaveType.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createLeaveType(params: {
  companyId: string;
  actorUserId: string;
  name: string;
  code: string;
  defaultAnnualDays: number;
  requiresProof: boolean;
  carryForwardAllowed: boolean;
  allowPastDates: boolean;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const currentYear = new Date().getUTCFullYear();

  try {
    return await tenant.$transaction(async (tx) => {
      const leaveType = await tx.leaveType.create({
        data: {
          companyId: params.companyId,
          name: params.name,
          code: params.code,
          defaultAnnualDays: params.defaultAnnualDays,
          requiresProof: params.requiresProof,
          carryForwardAllowed: params.carryForwardAllowed,
          allowPastDates: params.allowPastDates,
        },
      });

      const activeEmployees = await tx.employee.findMany({
        where: { companyId: params.companyId, status: "ACTIVE" },
        select: { id: true },
      });
      await Promise.all(
        activeEmployees.map((employee) =>
          tx.leaveBalance.create({
            data: {
              companyId: params.companyId,
              employeeId: employee.id,
              leaveTypeId: leaveType.id,
              year: currentYear,
              allocatedDays: params.defaultAnnualDays,
            },
          }),
        ),
      );

      await writeAudit(tx, {
        companyId: params.companyId,
        actorUserId: params.actorUserId,
        action: "LEAVE_TYPE_CREATED",
        entityType: "LeaveType",
        entityId: leaveType.id,
        metadata: { name: params.name, code: params.code },
      });

      return leaveType;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "LEAVE_TYPE_CODE_TAKEN", "A leave type with this code already exists.");
    }
    throw err;
  }
}

export async function updateLeaveType(params: {
  companyId: string;
  actorUserId: string;
  leaveTypeId: string;
  data: {
    name?: string;
    defaultAnnualDays?: number;
    requiresProof?: boolean;
    carryForwardAllowed?: boolean;
    allowPastDates?: boolean;
  };
}) {
  const tenant = getTenantPrisma(params.companyId);
  const existing = await tenant.leaveType.findUnique({ where: { id: params.leaveTypeId } });
  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Leave type not found.");
  }

  return tenant.$transaction(async (tx) => {
    const updated = await tx.leaveType.update({ where: { id: params.leaveTypeId }, data: params.data });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "LEAVE_TYPE_UPDATED",
      entityType: "LeaveType",
      entityId: params.leaveTypeId,
      metadata: params.data,
    });
    return updated;
  });
}

export async function deleteLeaveType(params: { companyId: string; actorUserId: string; leaveTypeId: string }) {
  const tenant = getTenantPrisma(params.companyId);
  const existing = await tenant.leaveType.findUnique({ where: { id: params.leaveTypeId } });
  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Leave type not found.");
  }

  const [balanceCount, requestCount] = await Promise.all([
    tenant.leaveBalance.count({ where: { companyId: params.companyId, leaveTypeId: params.leaveTypeId } }),
    tenant.leaveRequest.count({ where: { companyId: params.companyId, leaveTypeId: params.leaveTypeId } }),
  ]);
  if (balanceCount > 0 || requestCount > 0) {
    throw new ApiError(
      409,
      "LEAVE_TYPE_IN_USE",
      "This leave type has balances or requests referencing it and cannot be deleted.",
    );
  }

  await tenant.$transaction(async (tx) => {
    await tx.leaveType.delete({ where: { id: params.leaveTypeId } });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "LEAVE_TYPE_DELETED",
      entityType: "LeaveType",
      entityId: params.leaveTypeId,
    });
  });
}
