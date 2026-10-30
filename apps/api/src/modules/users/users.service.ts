import argon2 from "argon2";
import { ApiError } from "../../lib/errors.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { writeAudit } from "../../lib/audit.js";
import { generateTempPassword } from "../../lib/tempPassword.js";

type AssignableRole = "COMPANY_ADMIN" | "HR" | "MANAGER";

async function countOtherActiveAdmins(
  tenant: ReturnType<typeof getTenantPrisma>,
  companyId: string,
  excludingUserId: string,
) {
  return tenant.user.count({
    where: { companyId, role: "COMPANY_ADMIN", status: "ACTIVE", id: { not: excludingUserId } },
  });
}

export async function listUsers(companyId: string, pagination: { page: number; pageSize: number }) {
  const tenant = getTenantPrisma(companyId);
  const skip = (pagination.page - 1) * pagination.pageSize;
  const [data, total] = await Promise.all([
    tenant.user.findMany({ where: { companyId }, skip, take: pagination.pageSize, orderBy: { createdAt: "desc" } }),
    tenant.user.count({ where: { companyId } }),
  ]);
  return { data, total };
}

export async function createUser(params: {
  companyId: string;
  actorUserId: string;
  email: string;
  role: AssignableRole;
}) {
  const tenant = getTenantPrisma(params.companyId);

  const existing = await tenant.user.findFirst({ where: { companyId: params.companyId, email: params.email } });
  if (existing) {
    throw new ApiError(409, "EMAIL_TAKEN", "A user with this email already exists in this company.");
  }

  const temporaryPassword = generateTempPassword();
  const passwordHash = await argon2.hash(temporaryPassword);

  const user = await tenant.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        companyId: params.companyId,
        email: params.email,
        passwordHash,
        role: params.role,
        mustChangePassword: true,
      },
    });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "USER_CREATED",
      entityType: "User",
      entityId: created.id,
      metadata: { email: params.email, role: params.role },
    });
    return created;
  });

  return { user, temporaryPassword };
}

export async function updateUserRole(params: {
  companyId: string;
  actorUserId: string;
  targetUserId: string;
  role: AssignableRole;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const target = await tenant.user.findUnique({ where: { id: params.targetUserId } });
  if (!target) {
    throw new ApiError(404, "NOT_FOUND", "User not found.");
  }

  const isDemotingFromAdmin = target.role === "COMPANY_ADMIN" && params.role !== "COMPANY_ADMIN";

  if (isDemotingFromAdmin && params.targetUserId === params.actorUserId) {
    throw new ApiError(409, "CANNOT_MODIFY_SELF", "You cannot remove your own admin role.");
  }

  if (isDemotingFromAdmin && target.status === "ACTIVE") {
    const others = await countOtherActiveAdmins(tenant, params.companyId, target.id);
    if (others === 0) {
      throw new ApiError(409, "LAST_ADMIN", "A company must always have at least one active admin.");
    }
  }

  return tenant.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: params.targetUserId }, data: { role: params.role } });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "USER_ROLE_CHANGED",
      entityType: "User",
      entityId: params.targetUserId,
      metadata: { fromRole: target.role, toRole: params.role },
    });
    return updated;
  });
}

export async function updateUserStatus(params: {
  companyId: string;
  actorUserId: string;
  targetUserId: string;
  status: "ACTIVE" | "DEACTIVATED";
}) {
  const tenant = getTenantPrisma(params.companyId);
  const target = await tenant.user.findUnique({ where: { id: params.targetUserId } });
  if (!target) {
    throw new ApiError(404, "NOT_FOUND", "User not found.");
  }

  const isDeactivatingAdmin =
    params.status === "DEACTIVATED" && target.role === "COMPANY_ADMIN" && target.status === "ACTIVE";

  if (isDeactivatingAdmin && params.targetUserId === params.actorUserId) {
    throw new ApiError(409, "CANNOT_MODIFY_SELF", "You cannot deactivate your own account.");
  }

  if (isDeactivatingAdmin) {
    const others = await countOtherActiveAdmins(tenant, params.companyId, target.id);
    if (others === 0) {
      throw new ApiError(409, "LAST_ADMIN", "A company must always have at least one active admin.");
    }
  }

  return tenant.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: params.targetUserId }, data: { status: params.status } });
    if (params.status === "DEACTIVATED") {
      await tx.refreshToken.updateMany({
        where: { userId: params.targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: params.status === "DEACTIVATED" ? "USER_DEACTIVATED" : "USER_REACTIVATED",
      entityType: "User",
      entityId: params.targetUserId,
    });
    return updated;
  });
}
