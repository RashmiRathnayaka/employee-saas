import { Router } from "express";
import type { Employee } from "@prisma/client";
import {
  CreateEmployeeRequestSchema,
  EmployeeListQuerySchema,
  UpdateEmployeeRequestSchema,
  UpdateEmployeeStatusRequestSchema,
  UpdateOwnProfileRequestSchema,
  type EmployeeDto,
} from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { toUserDto } from "../../lib/dto.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import {
  createEmployee,
  getEmployeeById,
  getOwnProfile,
  listEmployees,
  updateEmployee,
  updateEmployeeStatus,
  updateOwnProfile,
} from "./employees.service.js";

export const employeesRouter = Router();

function toEmployeeDto(employee: Employee, userId: string | null): EmployeeDto {
  return {
    id: employee.id,
    companyId: employee.companyId,
    employeeCode: employee.employeeCode,
    firstName: employee.firstName,
    lastName: employee.lastName,
    phone: employee.phone,
    photoUrl: employee.photoUrl,
    departmentId: employee.departmentId,
    designationId: employee.designationId,
    managerId: employee.managerId,
    joiningDate: employee.joiningDate.toISOString().slice(0, 10),
    status: employee.status,
    userId,
  };
}

type EmployeeWithUser = Employee & { user: { id: string } | null };
function toEmployeeDtoWithUser(employee: EmployeeWithUser): EmployeeDto {
  return toEmployeeDto(employee, employee.user?.id ?? null);
}

employeesRouter.use("/employees", requireAuth, requireCompanyContext);

employeesRouter.get(
  "/employees",
  requireRole("COMPANY_ADMIN", "HR", "MANAGER"),
  asyncHandler(async (req, res) => {
    const query = EmployeeListQuerySchema.parse(req.query);
    const { data, total } = await listEmployees({
      companyId: req.auth!.companyId!,
      requesterRole: req.auth!.role,
      requesterEmployeeId: req.auth!.employeeId,
      ...query,
    });
    res.status(200).json({ data: data.map(toEmployeeDtoWithUser), page: query.page, pageSize: query.pageSize, total });
  }),
);

employeesRouter.post(
  "/employees",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(CreateEmployeeRequestSchema),
  asyncHandler(async (req, res) => {
    const { employee, user, temporaryPassword } = await createEmployee({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      ...req.body,
    });
    res.status(201).json({
      employee: toEmployeeDto(employee, user?.id ?? null),
      login: user && temporaryPassword ? { user: toUserDto(user), temporaryPassword } : null,
    });
  }),
);

// Must come before "/employees/:id" - see docs/architecture.md §3.
employeesRouter.get(
  "/employees/me",
  asyncHandler(async (req, res) => {
    if (!req.auth!.employeeId) {
      throw new ApiError(404, "NOT_FOUND", "You do not have an employee profile.");
    }
    const employee = await getOwnProfile({ companyId: req.auth!.companyId!, employeeId: req.auth!.employeeId });
    res.status(200).json({ employee: toEmployeeDtoWithUser(employee) });
  }),
);

employeesRouter.patch(
  "/employees/me",
  validateBody(UpdateOwnProfileRequestSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth!.employeeId) {
      throw new ApiError(404, "NOT_FOUND", "You do not have an employee profile.");
    }
    const employee = await updateOwnProfile({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      employeeId: req.auth!.employeeId,
      phone: req.body.phone,
    });
    res.status(200).json({ employee: toEmployeeDtoWithUser(employee) });
  }),
);

employeesRouter.get(
  "/employees/:id",
  asyncHandler(async (req, res) => {
    const employee = await getEmployeeById({
      companyId: req.auth!.companyId!,
      employeeId: req.params.id!,
      requesterRole: req.auth!.role,
      requesterEmployeeId: req.auth!.employeeId,
    });
    res.status(200).json({ employee: toEmployeeDtoWithUser(employee) });
  }),
);

employeesRouter.patch(
  "/employees/:id",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(UpdateEmployeeRequestSchema),
  asyncHandler(async (req, res) => {
    const employee = await updateEmployee({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      employeeId: req.params.id!,
      data: req.body,
    });
    res.status(200).json({ employee: toEmployeeDtoWithUser(employee) });
  }),
);

employeesRouter.patch(
  "/employees/:id/status",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(UpdateEmployeeStatusRequestSchema),
  asyncHandler(async (req, res) => {
    const employee = await updateEmployeeStatus({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      employeeId: req.params.id!,
      status: req.body.status,
    });
    res.status(200).json({ employee: toEmployeeDtoWithUser(employee) });
  }),
);
