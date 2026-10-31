import argon2 from "argon2";
import type { Prisma } from "@prisma/client";
import type { Role } from "@employee-saas/shared";
import { ApiError } from "../../lib/errors.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { writeAudit } from "../../lib/audit.js";
import { generateTempPassword } from "../../lib/tempPassword.js";
import { lockOrCreateBalance } from "../leaveRequests/leaveRequests.service.js";

type Tenant = ReturnType<typeof getTenantPrisma>;

async function assertActiveManagerInCompany(tenant: Tenant, managerId: string) {
  const manager = await tenant.employee.findUnique({ where: { id: managerId } });
  if (!manager || manager.status !== "ACTIVE") {
    throw new ApiError(400, "INVALID_MANAGER", "Manager must be an active employee in this company.");
  }
}

async function wouldCreateCycle(tenant: Tenant, employeeId: string, proposedManagerId: string): Promise<boolean> {
  let currentId: string | null = proposedManagerId;
  const seen = new Set<string>();
  while (currentId) {
    if (currentId === employeeId) return true;
    if (seen.has(currentId)) break;
    seen.add(currentId);
    const current: { managerId: string | null } | null = await tenant.employee.findUnique({
      where: { id: currentId },
      select: { managerId: true },
    });
    currentId = current?.managerId ?? null;
  }
  return false;
}

export async function createEmployee(params: {
  companyId: string;
  actorUserId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  departmentId?: string;
  designationId?: string;
  managerId?: string;
  joiningDate: string;
  createLogin: boolean;
  loginEmail?: string;
  loginRole: "EMPLOYEE" | "MANAGER" | "HR";
}) {
  const tenant = getTenantPrisma(params.companyId);

  if (params.managerId) {
    await assertActiveManagerInCompany(tenant, params.managerId);
  }

  let temporaryPassword: string | undefined;
  let passwordHash: string | undefined;
  if (params.createLogin) {
    if (!params.loginEmail) {
      throw new ApiError(400, "VALIDATION_ERROR", "loginEmail is required when createLogin is true.");
    }
    const existingUser = await tenant.user.findFirst({
      where: { companyId: params.companyId, email: params.loginEmail },
    });
    if (existingUser) {
      throw new ApiError(409, "EMAIL_TAKEN", "A user with this email already exists in this company.");
    }
    temporaryPassword = generateTempPassword();
    passwordHash = await argon2.hash(temporaryPassword);
  }

  const { employee, user } = await tenant.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ prefix: string; assigned: number }[]>`
      UPDATE company_settings
      SET "employeeIdNextNumber" = "employeeIdNextNumber" + 1
      WHERE "companyId" = ${params.companyId}
      RETURNING "employeeIdPrefix" AS prefix, "employeeIdNextNumber" - 1 AS assigned
    `;
    const row = rows[0];
    if (!row) {
      throw new ApiError(500, "INTERNAL_ERROR", "Company settings not found.");
    }
    const employeeCode = `${row.prefix}${String(row.assigned).padStart(3, "0")}`;

    const employee = await tx.employee.create({
      data: {
        companyId: params.companyId,
        employeeCode,
        firstName: params.firstName,
        lastName: params.lastName,
        phone: params.phone,
        departmentId: params.departmentId,
        designationId: params.designationId,
        managerId: params.managerId,
        joiningDate: new Date(params.joiningDate),
      },
    });

    const leaveTypes = await tx.leaveType.findMany({ where: { companyId: params.companyId } });
    const currentYear = new Date().getUTCFullYear();
    await Promise.all(
      leaveTypes.map((leaveType) =>
        tx.leaveBalance.create({
          data: {
            companyId: params.companyId,
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            year: currentYear,
            allocatedDays: leaveType.defaultAnnualDays,
          },
        }),
      ),
    );

    let user = null;
    if (params.createLogin && passwordHash && params.loginEmail) {
      user = await tx.user.create({
        data: {
          companyId: params.companyId,
          employeeId: employee.id,
          email: params.loginEmail,
          passwordHash,
          role: params.loginRole,
          mustChangePassword: true,
        },
      });
    }

    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "EMPLOYEE_CREATED",
      entityType: "Employee",
      entityId: employee.id,
      metadata: { employeeCode, createdLogin: params.createLogin },
    });

    return { employee, user };
  });

  return { employee, user, temporaryPassword };
}

export async function listEmployees(params: {
  companyId: string;
  requesterRole: Role;
  requesterEmployeeId: string | null;
  page: number;
  pageSize: number;
  search?: string;
  departmentId?: string;
  status?: "ACTIVE" | "INACTIVE";
}) {
  const tenant = getTenantPrisma(params.companyId);
  const skip = (params.page - 1) * params.pageSize;

  const where: Prisma.EmployeeWhereInput = { companyId: params.companyId };
  if (params.departmentId) where.departmentId = params.departmentId;
  if (params.status) where.status = params.status;
  if (params.search) {
    where.OR = [
      { firstName: { contains: params.search, mode: "insensitive" } },
      { lastName: { contains: params.search, mode: "insensitive" } },
      { employeeCode: { contains: params.search, mode: "insensitive" } },
    ];
  }

  if (params.requesterRole === "MANAGER") {
    if (!params.requesterEmployeeId) {
      return { data: [], total: 0 };
    }
    where.managerId = params.requesterEmployeeId;
  }

  const [data, total] = await Promise.all([
    tenant.employee.findMany({
      where,
      skip,
      take: params.pageSize,
      orderBy: { employeeCode: "asc" },
      include: { user: { select: { id: true } } },
    }),
    tenant.employee.count({ where }),
  ]);
  return { data, total };
}

export async function getEmployeeById(params: {
  companyId: string;
  employeeId: string;
  requesterRole: Role;
  requesterEmployeeId: string | null;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const employee = await tenant.employee.findUnique({
    where: { id: params.employeeId },
    include: { user: { select: { id: true } } },
  });
  if (!employee) {
    throw new ApiError(404, "NOT_FOUND", "Employee not found.");
  }

  if (params.requesterRole === "EMPLOYEE" && employee.id !== params.requesterEmployeeId) {
    throw new ApiError(404, "NOT_FOUND", "Employee not found.");
  }

  if (
    params.requesterRole === "MANAGER" &&
    employee.id !== params.requesterEmployeeId &&
    employee.managerId !== params.requesterEmployeeId
  ) {
    throw new ApiError(404, "NOT_FOUND", "Employee not found.");
  }

  return employee;
}

export async function updateEmployee(params: {
  companyId: string;
  actorUserId: string;
  employeeId: string;
  data: {
    firstName?: string;
    lastName?: string;
    phone?: string | null;
    departmentId?: string | null;
    designationId?: string | null;
    managerId?: string | null;
  };
}) {
  const tenant = getTenantPrisma(params.companyId);
  const existing = await tenant.employee.findUnique({ where: { id: params.employeeId } });
  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Employee not found.");
  }

  if (params.data.managerId !== undefined && params.data.managerId !== null) {
    const managerId = params.data.managerId;
    if (managerId === params.employeeId) {
      throw new ApiError(400, "INVALID_MANAGER", "An employee cannot be their own manager.");
    }
    await assertActiveManagerInCompany(tenant, managerId);
    if (await wouldCreateCycle(tenant, params.employeeId, managerId)) {
      throw new ApiError(400, "MANAGER_CYCLE", "This manager assignment would create a reporting cycle.");
    }
  }

  return tenant.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id: params.employeeId },
      data: params.data,
      include: { user: { select: { id: true } } },
    });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: params.data.managerId !== undefined ? "EMPLOYEE_MANAGER_CHANGED" : "EMPLOYEE_UPDATED",
      entityType: "Employee",
      entityId: params.employeeId,
      metadata: params.data,
    });
    return updated;
  });
}

export async function updateEmployeeStatus(params: {
  companyId: string;
  actorUserId: string;
  employeeId: string;
  status: "ACTIVE" | "INACTIVE";
}) {
  const tenant = getTenantPrisma(params.companyId);
  const employee = await tenant.employee.findUnique({ where: { id: params.employeeId }, include: { user: true } });
  if (!employee) {
    throw new ApiError(404, "NOT_FOUND", "Employee not found.");
  }

  const linkedUser = employee.user;

  const isDeactivatingActiveAdmin =
    params.status === "INACTIVE" && linkedUser?.role === "COMPANY_ADMIN" && linkedUser.status === "ACTIVE";

  if (isDeactivatingActiveAdmin && linkedUser!.id === params.actorUserId) {
    throw new ApiError(409, "CANNOT_MODIFY_SELF", "You cannot deactivate your own account.");
  }

  if (isDeactivatingActiveAdmin) {
    const others = await tenant.user.count({
      where: { companyId: params.companyId, role: "COMPANY_ADMIN", status: "ACTIVE", id: { not: linkedUser!.id } },
    });
    if (others === 0) {
      throw new ApiError(409, "LAST_ADMIN", "A company must always have at least one active admin.");
    }
  }

  return tenant.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id: params.employeeId },
      data: { status: params.status },
      include: { user: { select: { id: true } } },
    });

    if (params.status === "INACTIVE" && linkedUser) {
      await tx.user.update({ where: { id: linkedUser.id }, data: { status: "DEACTIVATED" } });
      await tx.refreshToken.updateMany({
        where: { userId: linkedUser.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    if (params.status === "INACTIVE") {
      // Auto-cancel anything still pending and release its reserved days -
      // see docs/architecture.md §3 (same pending/used math as a normal
      // cancel) and Step 1.4's integration rule on deactivation.
      const pendingRequests = await tx.leaveRequest.findMany({
        where: { employeeId: params.employeeId, status: { in: ["PENDING_MANAGER", "PENDING_HR"] } },
      });
      for (const pending of pendingRequests) {
        const year = pending.startDate.getUTCFullYear();
        await lockOrCreateBalance(tx, {
          companyId: params.companyId,
          employeeId: params.employeeId,
          leaveTypeId: pending.leaveTypeId,
          year,
          defaultAllocatedDays: 0,
        });
        await tx.leaveBalance.update({
          where: {
            companyId_employeeId_leaveTypeId_year: {
              companyId: params.companyId,
              employeeId: params.employeeId,
              leaveTypeId: pending.leaveTypeId,
              year,
            },
          },
          data: { pendingDays: { decrement: pending.totalDays } },
        });
        await tx.leaveRequest.update({ where: { id: pending.id }, data: { status: "CANCELLED" } });
        await writeAudit(tx, {
          companyId: params.companyId,
          actorUserId: params.actorUserId,
          action: "LEAVE_REQUEST_CANCELLED",
          entityType: "LeaveRequest",
          entityId: pending.id,
          metadata: { reason: "employee_deactivated" },
        });
      }
    }

    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: params.status === "INACTIVE" ? "EMPLOYEE_DEACTIVATED" : "EMPLOYEE_REACTIVATED",
      entityType: "Employee",
      entityId: params.employeeId,
    });
    return updated;
  });
}

export async function getOwnProfile(params: { companyId: string; employeeId: string }) {
  const tenant = getTenantPrisma(params.companyId);
  const employee = await tenant.employee.findUnique({
    where: { id: params.employeeId },
    include: { user: { select: { id: true } } },
  });
  if (!employee) {
    throw new ApiError(404, "NOT_FOUND", "Employee profile not found.");
  }
  return employee;
}

export async function updateOwnProfile(params: {
  companyId: string;
  actorUserId: string;
  employeeId: string;
  phone?: string | null;
}) {
  const tenant = getTenantPrisma(params.companyId);
  return tenant.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id: params.employeeId },
      data: { phone: params.phone },
      include: { user: { select: { id: true } } },
    });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "EMPLOYEE_SELF_UPDATED",
      entityType: "Employee",
      entityId: params.employeeId,
      metadata: { phone: params.phone },
    });
    return updated;
  });
}
