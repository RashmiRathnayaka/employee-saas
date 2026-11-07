import { Router } from "express";
import { SetEmployeeScheduleRequestSchema } from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ownEmployee } from "../../lib/ownEmployee.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireModule } from "../../middleware/requireModule.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { getEmployeeSchedule, getMySchedule, removeEmployeeSchedule, setEmployeeSchedule } from "./schedules.service.js";

export const schedulesRouter = Router();

// Route by route rather than a `use("/employees")`, which would gate the Phase 1
// employee endpoints behind the attendance module too.
const gated = [requireAuth, requireCompanyContext, requireModule("attendance")];

schedulesRouter.get(
  "/schedule/me",
  gated,
  asyncHandler(async (req, res) => {
    res.status(200).json(await getMySchedule(ownEmployee(req)));
  }),
);

schedulesRouter.get(
  "/employees/:id/schedule",
  gated,
  requireRole("COMPANY_ADMIN", "HR", "MANAGER"),
  asyncHandler(async (req, res) => {
    const result = await getEmployeeSchedule({
      companyId: req.auth!.companyId!,
      role: req.auth!.role,
      callerEmployeeId: req.auth!.employeeId,
      employeeId: req.params.id!,
    });
    res.status(200).json(result);
  }),
);

schedulesRouter.put(
  "/employees/:id/schedule",
  gated,
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(SetEmployeeScheduleRequestSchema),
  asyncHandler(async (req, res) => {
    const result = await setEmployeeSchedule({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      actorEmployeeId: req.auth!.employeeId,
      employeeId: req.params.id!,
      data: req.body,
    });
    res.status(200).json(result);
  }),
);

schedulesRouter.delete(
  "/employees/:id/schedule",
  gated,
  requireRole("COMPANY_ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    await removeEmployeeSchedule({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      actorEmployeeId: req.auth!.employeeId,
      employeeId: req.params.id!,
    });
    res.status(204).send();
  }),
);
