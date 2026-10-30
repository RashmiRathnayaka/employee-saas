import { Router } from "express";
import { CreateDepartmentRequestSchema, UpdateDepartmentRequestSchema } from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { createDepartment, deleteDepartment, listDepartments, updateDepartment } from "./departments.service.js";

export const departmentsRouter = Router();

departmentsRouter.use("/departments", requireAuth, requireCompanyContext);

departmentsRouter.get(
  "/departments",
  asyncHandler(async (req, res) => {
    const departments = await listDepartments(req.auth!.companyId!);
    res.status(200).json({ data: departments });
  }),
);

departmentsRouter.post(
  "/departments",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(CreateDepartmentRequestSchema),
  asyncHandler(async (req, res) => {
    const department = await createDepartment({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      name: req.body.name,
    });
    res.status(201).json({ department });
  }),
);

departmentsRouter.patch(
  "/departments/:id",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(UpdateDepartmentRequestSchema),
  asyncHandler(async (req, res) => {
    const department = await updateDepartment({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      departmentId: req.params.id!,
      name: req.body.name,
    });
    res.status(200).json({ department });
  }),
);

departmentsRouter.delete(
  "/departments/:id",
  requireRole("COMPANY_ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    await deleteDepartment({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      departmentId: req.params.id!,
    });
    res.status(204).send();
  }),
);
