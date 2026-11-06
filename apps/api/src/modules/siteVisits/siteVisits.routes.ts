import { Router } from "express";
import {
  CorrectSiteVisitRequestSchema,
  MySiteVisitsQuerySchema,
  SiteCheckInRequestSchema,
  SiteCheckOutRequestSchema,
  SiteVisitListQuerySchema,
} from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ownEmployee } from "../../lib/ownEmployee.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireModule } from "../../middleware/requireModule.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { checkIn, checkOut, correctVisit, getMyOpenVisit, getVisit, listAllVisits, listMyVisits, listTeamVisits } from "./siteVisits.service.js";

export const siteVisitsRouter = Router();

siteVisitsRouter.use("/site-visits", requireAuth, requireCompanyContext, requireModule("sites"));

siteVisitsRouter.post(
  "/site-visits/check-in",
  validateBody(SiteCheckInRequestSchema),
  asyncHandler(async (req, res) => {
    const { visit, created } = await checkIn({
      ...ownEmployee(req),
      userId: req.auth!.userId,
      siteId: req.body.siteId,
      clientRequestId: req.body.clientRequestId,
      location: req.body.location ?? null,
      note: req.body.note ?? null,
    });
    res.status(created ? 201 : 200).json({ visit });
  }),
);

siteVisitsRouter.post(
  "/site-visits/:id/check-out",
  validateBody(SiteCheckOutRequestSchema),
  asyncHandler(async (req, res) => {
    const visit = await checkOut({
      ...ownEmployee(req),
      visitId: req.params.id!,
      location: req.body.location ?? null,
      note: req.body.note ?? null,
    });
    res.status(200).json({ visit });
  }),
);

siteVisitsRouter.get(
  "/site-visits/me",
  asyncHandler(async (req, res) => {
    const own = ownEmployee(req);
    res.status(200).json(await listMyVisits({ ...own, query: MySiteVisitsQuerySchema.parse(req.query) }));
  }),
);

siteVisitsRouter.get(
  "/site-visits/me/open",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getMyOpenVisit(ownEmployee(req)));
  }),
);

siteVisitsRouter.get(
  "/site-visits/team",
  requireRole("MANAGER"),
  asyncHandler(async (req, res) => {
    const { companyId, employeeId } = ownEmployee(req);
    const query = SiteVisitListQuerySchema.parse(req.query);
    res.status(200).json(await listTeamVisits({ companyId, managerEmployeeId: employeeId, query }));
  }),
);

siteVisitsRouter.get(
  "/site-visits",
  requireRole("COMPANY_ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const query = SiteVisitListQuerySchema.parse(req.query);
    res.status(200).json(await listAllVisits({ companyId: req.auth!.companyId!, query }));
  }),
);

// After the fixed paths above, which this pattern would otherwise swallow.
siteVisitsRouter.get(
  "/site-visits/:id",
  asyncHandler(async (req, res) => {
    const detail = await getVisit({
      companyId: req.auth!.companyId!,
      role: req.auth!.role,
      callerEmployeeId: req.auth!.employeeId,
      visitId: req.params.id!,
    });
    res.status(200).json(detail);
  }),
);

siteVisitsRouter.patch(
  "/site-visits/:id/correct",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(CorrectSiteVisitRequestSchema),
  asyncHandler(async (req, res) => {
    const visit = await correctVisit({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      actorEmployeeId: req.auth!.employeeId,
      visitId: req.params.id!,
      data: req.body,
    });
    res.status(200).json({ visit });
  }),
);
