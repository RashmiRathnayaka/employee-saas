import { Router } from "express";
import {
  CreateSiteRequestSchema,
  SiteListQuerySchema,
  UpdateSiteRequestSchema,
  UpdateSiteStatusRequestSchema,
} from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireModule } from "../../middleware/requireModule.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { createSite, deleteSite, getSite, listSites, setSiteActive, updateSite } from "./sites.service.js";

export const sitesRouter = Router();

sitesRouter.use("/sites", requireAuth, requireCompanyContext, requireModule("sites"));

sitesRouter.get(
  "/sites",
  asyncHandler(async (req, res) => {
    const query = SiteListQuerySchema.parse(req.query);
    const result = await listSites({ companyId: req.auth!.companyId!, role: req.auth!.role, query });
    res.status(200).json(result);
  }),
);

sitesRouter.get(
  "/sites/:id",
  asyncHandler(async (req, res) => {
    const site = await getSite({ companyId: req.auth!.companyId!, role: req.auth!.role, siteId: req.params.id! });
    res.status(200).json({ site });
  }),
);

sitesRouter.post(
  "/sites",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(CreateSiteRequestSchema),
  asyncHandler(async (req, res) => {
    const site = await createSite({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      data: req.body,
    });
    res.status(201).json({ site });
  }),
);

sitesRouter.patch(
  "/sites/:id",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(UpdateSiteRequestSchema),
  asyncHandler(async (req, res) => {
    const site = await updateSite({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      siteId: req.params.id!,
      data: req.body,
    });
    res.status(200).json({ site });
  }),
);

sitesRouter.patch(
  "/sites/:id/status",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(UpdateSiteStatusRequestSchema),
  asyncHandler(async (req, res) => {
    const site = await setSiteActive({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      siteId: req.params.id!,
      isActive: req.body.isActive,
    });
    res.status(200).json({ site });
  }),
);

sitesRouter.delete(
  "/sites/:id",
  requireRole("COMPANY_ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    await deleteSite({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      siteId: req.params.id!,
    });
    res.status(204).send();
  }),
);
