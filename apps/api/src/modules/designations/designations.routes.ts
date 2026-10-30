import { Router } from "express";
import { CreateDesignationRequestSchema, UpdateDesignationRequestSchema } from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { createDesignation, deleteDesignation, listDesignations, updateDesignation } from "./designations.service.js";

export const designationsRouter = Router();

designationsRouter.use("/designations", requireAuth, requireCompanyContext);

designationsRouter.get(
  "/designations",
  asyncHandler(async (req, res) => {
    const designations = await listDesignations(req.auth!.companyId!);
    res.status(200).json({ data: designations });
  }),
);

designationsRouter.post(
  "/designations",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(CreateDesignationRequestSchema),
  asyncHandler(async (req, res) => {
    const designation = await createDesignation({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      name: req.body.name,
    });
    res.status(201).json({ designation });
  }),
);

designationsRouter.patch(
  "/designations/:id",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(UpdateDesignationRequestSchema),
  asyncHandler(async (req, res) => {
    const designation = await updateDesignation({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      designationId: req.params.id!,
      name: req.body.name,
    });
    res.status(200).json({ designation });
  }),
);

designationsRouter.delete(
  "/designations/:id",
  requireRole("COMPANY_ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    await deleteDesignation({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      designationId: req.params.id!,
    });
    res.status(204).send();
  }),
);
