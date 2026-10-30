import { ApiError } from "../../lib/errors.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { writeAudit } from "../../lib/audit.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";

export async function listDesignations(companyId: string) {
  const tenant = getTenantPrisma(companyId);
  return tenant.designation.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createDesignation(params: { companyId: string; actorUserId: string; name: string }) {
  const tenant = getTenantPrisma(params.companyId);

  const existing = await tenant.designation.findFirst({
    where: { companyId: params.companyId, name: { equals: params.name, mode: "insensitive" } },
  });
  if (existing) {
    throw new ApiError(409, "DESIGNATION_NAME_TAKEN", "A designation with this name already exists.");
  }

  try {
    return await tenant.$transaction(async (tx) => {
      const designation = await tx.designation.create({ data: { companyId: params.companyId, name: params.name } });
      await writeAudit(tx, {
        companyId: params.companyId,
        actorUserId: params.actorUserId,
        action: "DESIGNATION_CREATED",
        entityType: "Designation",
        entityId: designation.id,
        metadata: { name: params.name },
      });
      return designation;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "DESIGNATION_NAME_TAKEN", "A designation with this name already exists.");
    }
    throw err;
  }
}

export async function updateDesignation(params: {
  companyId: string;
  actorUserId: string;
  designationId: string;
  name: string;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const existing = await tenant.designation.findUnique({ where: { id: params.designationId } });
  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Designation not found.");
  }

  const duplicate = await tenant.designation.findFirst({
    where: {
      companyId: params.companyId,
      name: { equals: params.name, mode: "insensitive" },
      id: { not: params.designationId },
    },
  });
  if (duplicate) {
    throw new ApiError(409, "DESIGNATION_NAME_TAKEN", "A designation with this name already exists.");
  }

  try {
    return await tenant.$transaction(async (tx) => {
      const designation = await tx.designation.update({
        where: { id: params.designationId },
        data: { name: params.name },
      });
      await writeAudit(tx, {
        companyId: params.companyId,
        actorUserId: params.actorUserId,
        action: "DESIGNATION_UPDATED",
        entityType: "Designation",
        entityId: params.designationId,
        metadata: { name: params.name },
      });
      return designation;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "DESIGNATION_NAME_TAKEN", "A designation with this name already exists.");
    }
    throw err;
  }
}

export async function deleteDesignation(params: { companyId: string; actorUserId: string; designationId: string }) {
  const tenant = getTenantPrisma(params.companyId);
  const existing = await tenant.designation.findUnique({ where: { id: params.designationId } });
  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Designation not found.");
  }

  const employeeCount = await tenant.employee.count({
    where: { companyId: params.companyId, designationId: params.designationId },
  });
  if (employeeCount > 0) {
    throw new ApiError(
      409,
      "DESIGNATION_IN_USE",
      `This designation still has ${employeeCount} employee(s) assigned to it. Reassign them before deleting it.`,
    );
  }

  await tenant.$transaction(async (tx) => {
    await tx.designation.delete({ where: { id: params.designationId } });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "DESIGNATION_DELETED",
      entityType: "Designation",
      entityId: params.designationId,
    });
  });
}
