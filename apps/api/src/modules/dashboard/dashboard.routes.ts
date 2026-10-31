import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getAdminDashboardSummary, getManagerDashboardSummary } from "./dashboard.service.js";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/dashboard/summary",
  requireAuth,
  requireCompanyContext,
  requireRole("COMPANY_ADMIN", "HR", "MANAGER"),
  asyncHandler(async (req, res) => {
    if (req.auth!.role === "MANAGER") {
      if (!req.auth!.employeeId) {
        throw new ApiError(403, "FORBIDDEN", "This action requires an employee profile.");
      }
      const summary = await getManagerDashboardSummary({
        companyId: req.auth!.companyId!,
        managerEmployeeId: req.auth!.employeeId,
      });
      res.status(200).json(summary);
      return;
    }

    const summary = await getAdminDashboardSummary(req.auth!.companyId!);
    res.status(200).json(summary);
  }),
);
