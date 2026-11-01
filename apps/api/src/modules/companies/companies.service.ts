import { ApiError } from "../../lib/errors.js";
import { platformPrisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { generateTempPassword } from "../../lib/tempPassword.js";
import { DEFAULT_LEAVE_TYPES } from "../../lib/defaultLeaveTypes.js";
import { hashPassword } from "../../lib/passwordHashing.js";

export async function createCompany(params: {
  name: string;
  code: string;
  adminEmail: string;
  actorUserId: string;
}) {
  const existing = await platformPrisma.company.findUnique({ where: { code: params.code } });
  if (existing) {
    throw new ApiError(409, "COMPANY_CODE_TAKEN", "A company with this code already exists.");
  }

  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const { company, admin } = await platformPrisma.$transaction(async (tx) => {
    const company = await tx.company.create({ data: { name: params.name, code: params.code } });
    await tx.companySettings.create({ data: { companyId: company.id } });

    const admin = await tx.user.create({
      data: {
        companyId: company.id,
        email: params.adminEmail,
        passwordHash,
        role: "COMPANY_ADMIN",
        mustChangePassword: true,
      },
    });

    await Promise.all(
      DEFAULT_LEAVE_TYPES.map((leaveType) => tx.leaveType.create({ data: { companyId: company.id, ...leaveType } })),
    );

    await writeAudit(tx, {
      companyId: company.id,
      actorUserId: params.actorUserId,
      action: "COMPANY_CREATED",
      entityType: "Company",
      entityId: company.id,
      metadata: { code: company.code, adminEmail: params.adminEmail },
    });

    return { company, admin };
  });

  return { company, admin, temporaryPassword };
}

export async function listCompanies(params: { page: number; pageSize: number }) {
  const skip = (params.page - 1) * params.pageSize;
  const [data, total] = await Promise.all([
    platformPrisma.company.findMany({ skip, take: params.pageSize, orderBy: { createdAt: "desc" } }),
    platformPrisma.company.count(),
  ]);
  return { data, total };
}

export async function getCompanyById(id: string) {
  const company = await platformPrisma.company.findUnique({ where: { id } });
  if (!company) {
    throw new ApiError(404, "NOT_FOUND", "Company not found.");
  }
  return company;
}

export async function updateCompanyStatus(params: {
  id: string;
  status: "ACTIVE" | "SUSPENDED";
  actorUserId: string;
}) {
  const existing = await platformPrisma.company.findUnique({ where: { id: params.id } });
  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Company not found.");
  }

  return platformPrisma.$transaction(async (tx) => {
    const updated = await tx.company.update({ where: { id: params.id }, data: { status: params.status } });
    await writeAudit(tx, {
      companyId: params.id,
      actorUserId: params.actorUserId,
      action: params.status === "SUSPENDED" ? "COMPANY_SUSPENDED" : "COMPANY_REACTIVATED",
      entityType: "Company",
      entityId: params.id,
    });
    return updated;
  });
}
