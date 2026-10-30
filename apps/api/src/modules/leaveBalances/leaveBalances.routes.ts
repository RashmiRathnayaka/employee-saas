import { Router } from "express";
import type { LeaveBalance } from "@prisma/client";
import { AdjustLeaveBalanceRequestSchema, type LeaveBalanceDto } from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { adjustBalance, getBalancesForEmployee } from "./leaveBalances.service.js";

export const leaveBalancesRouter = Router();

function toLeaveBalanceDto(balance: LeaveBalance): LeaveBalanceDto {
  const allocated = balance.allocatedDays.toNumber();
  const used = balance.usedDays.toNumber();
  const pending = balance.pendingDays.toNumber();
  const carried = balance.carriedOverDays.toNumber();
  return {
    id: balance.id,
    employeeId: balance.employeeId,
    leaveTypeId: balance.leaveTypeId,
    year: balance.year,
    allocatedDays: allocated,
    usedDays: used,
    pendingDays: pending,
    carriedOverDays: carried,
    availableDays: Math.round((allocated + carried - used - pending) * 100) / 100,
  };
}

leaveBalancesRouter.get(
  "/leave-balances/me",
  requireAuth,
  requireCompanyContext,
  asyncHandler(async (req, res) => {
    if (!req.auth!.employeeId) {
      throw new ApiError(404, "NOT_FOUND", "You do not have an employee profile.");
    }
    const balances = await getBalancesForEmployee({
      companyId: req.auth!.companyId!,
      employeeId: req.auth!.employeeId,
      requesterRole: req.auth!.role,
      requesterEmployeeId: req.auth!.employeeId,
    });
    res.status(200).json({ data: balances.map(toLeaveBalanceDto) });
  }),
);

leaveBalancesRouter.get(
  "/employees/:id/leave-balances",
  requireAuth,
  requireCompanyContext,
  requireRole("COMPANY_ADMIN", "HR", "MANAGER"),
  asyncHandler(async (req, res) => {
    const balances = await getBalancesForEmployee({
      companyId: req.auth!.companyId!,
      employeeId: req.params.id!,
      requesterRole: req.auth!.role,
      requesterEmployeeId: req.auth!.employeeId,
    });
    res.status(200).json({ data: balances.map(toLeaveBalanceDto) });
  }),
);

leaveBalancesRouter.post(
  "/employees/:id/leave-balances/adjust",
  requireAuth,
  requireCompanyContext,
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(AdjustLeaveBalanceRequestSchema),
  asyncHandler(async (req, res) => {
    const balance = await adjustBalance({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      employeeId: req.params.id!,
      ...req.body,
    });
    res.status(200).json({ balance: toLeaveBalanceDto(balance) });
  }),
);
