import { Router } from "express";
import type { LeaveType } from "@prisma/client";
import { CreateLeaveTypeRequestSchema, UpdateLeaveTypeRequestSchema, type LeaveTypeDto } from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { createLeaveType, deleteLeaveType, listLeaveTypes, updateLeaveType } from "./leaveTypes.service.js";

export const leaveTypesRouter = Router();

function toLeaveTypeDto(leaveType: LeaveType): LeaveTypeDto {
  return {
    id: leaveType.id,
    name: leaveType.name,
    code: leaveType.code,
    defaultAnnualDays: leaveType.defaultAnnualDays.toNumber(),
    requiresProof: leaveType.requiresProof,
    carryForwardAllowed: leaveType.carryForwardAllowed,
    allowPastDates: leaveType.allowPastDates,
  };
}

leaveTypesRouter.use("/leave-types", requireAuth, requireCompanyContext);

leaveTypesRouter.get(
  "/leave-types",
  asyncHandler(async (req, res) => {
    const leaveTypes = await listLeaveTypes(req.auth!.companyId!);
    res.status(200).json({ data: leaveTypes.map(toLeaveTypeDto) });
  }),
);

leaveTypesRouter.post(
  "/leave-types",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(CreateLeaveTypeRequestSchema),
  asyncHandler(async (req, res) => {
    const leaveType = await createLeaveType({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      ...req.body,
    });
    res.status(201).json({ leaveType: toLeaveTypeDto(leaveType) });
  }),
);

leaveTypesRouter.patch(
  "/leave-types/:id",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(UpdateLeaveTypeRequestSchema),
  asyncHandler(async (req, res) => {
    const leaveType = await updateLeaveType({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      leaveTypeId: req.params.id!,
      data: req.body,
    });
    res.status(200).json({ leaveType: toLeaveTypeDto(leaveType) });
  }),
);

leaveTypesRouter.delete(
  "/leave-types/:id",
  requireRole("COMPANY_ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    await deleteLeaveType({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      leaveTypeId: req.params.id!,
    });
    res.status(204).send();
  }),
);
