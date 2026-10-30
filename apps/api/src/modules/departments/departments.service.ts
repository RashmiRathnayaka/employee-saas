import { ApiError } from "../../lib/errors.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { writeAudit } from "../../lib/audit.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";

export async function listDepartments(companyId: string) {
  const tenant = getTenantPrisma(companyId);
  return tenant.department.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createDepartment(params: { companyId: string; actorUserId: string; name: string }) {
  const tenant = getTenantPrisma(params.companyId);

  const existing = await tenant.department.findFirst({
    where: { companyId: params.companyId, name: { equals: params.name, mode: "insensitive" } },
  });
  if (existing) {
    throw new ApiError(409, "DEPARTMENT_NAME_TAKEN", "A department with this name already exists.");
  }

  try {
    return await tenant.$transaction(async (tx) => {
      const department = await tx.department.create({ data: { companyId: params.companyId, name: params.name } });
      await writeAudit(tx, {
        companyId: params.companyId,
        actorUserId: params.actorUserId,
        action: "DEPARTMENT_CREATED",
        entityType: "Department",
        entityId: department.id,
        metadata: { name: params.name },
      });
      return department;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "DEPARTMENT_NAME_TAKEN", "A department with this name already exists.");
    }
    throw err;
  }
}

export async function updateDepartment(params: {
  companyId: string;
  actorUserId: string;
  departmentId: string;
  name: string;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const existing = await tenant.department.findUnique({ where: { id: params.departmentId } });
  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Department not found.");
  }

  const duplicate = await tenant.department.findFirst({
    where: { companyId: params.companyId, name: { equals: params.name, mode: "insensitive" }, id: { not: params.departmentId } },
  });
  if (duplicate) {
    throw new ApiError(409, "DEPARTMENT_NAME_TAKEN", "A department with this name already exists.");
  }

  try {
    return await tenant.$transaction(async (tx) => {
      const department = await tx.department.update({ where: { id: params.departmentId }, data: { name: params.name } });
      await writeAudit(tx, {
        companyId: params.companyId,
        actorUserId: params.actorUserId,
        action: "DEPARTMENT_UPDATED",
        entityType: "Department",
        entityId: params.departmentId,
        metadata: { name: params.name },
      });
      return department;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "DEPARTMENT_NAME_TAKEN", "A department with this name already exists.");
    }
    throw err;
  }
}

export async function deleteDepartment(params: { companyId: string; actorUserId: string; departmentId: string }) {
  const tenant = getTenantPrisma(params.companyId);
  const existing = await tenant.department.findUnique({ where: { id: params.departmentId } });
  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Department not found.");
  }

  const employeeCount = await tenant.employee.count({ where: { companyId: params.companyId, departmentId: params.departmentId } });
  if (employeeCount > 0) {
    throw new ApiError(
      409,
      "DEPARTMENT_IN_USE",
      `This department still has ${employeeCount} employee(s) assigned to it. Reassign them before deleting it.`,
    );
  }

  await tenant.$transaction(async (tx) => {
    await tx.department.delete({ where: { id: params.departmentId } });
    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "DEPARTMENT_DELETED",
      entityType: "Department",
      entityId: params.departmentId,
    });
  });
}
