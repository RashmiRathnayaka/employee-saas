import { Router } from "express";
import {
  CreateHolidayRequestSchema,
  UpdateCompanyProfileRequestSchema,
  UpdateCompanySettingsRequestSchema,
} from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import {
  createHoliday,
  deleteHoliday,
  getOwnCompany,
  getOwnSettings,
  listHolidays,
  updateOwnCompany,
  updateOwnSettings,
} from "./company.service.js";

export const companyRouter = Router();

companyRouter.use("/company", requireAuth, requireCompanyContext);

companyRouter.get(
  "/company",
  asyncHandler(async (req, res) => {
    const company = await getOwnCompany(req.auth!.companyId!);
    res.status(200).json({ company });
  }),
);

companyRouter.patch(
  "/company",
  requireRole("COMPANY_ADMIN"),
  validateBody(UpdateCompanyProfileRequestSchema),
  asyncHandler(async (req, res) => {
    const company = await updateOwnCompany({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      data: req.body,
    });
    res.status(200).json({ company });
  }),
);

companyRouter.get(
  "/company/settings",
  asyncHandler(async (req, res) => {
    const settings = await getOwnSettings(req.auth!.companyId!);
    res.status(200).json({ settings });
  }),
);

companyRouter.patch(
  "/company/settings",
  requireRole("COMPANY_ADMIN"),
  validateBody(UpdateCompanySettingsRequestSchema),
  asyncHandler(async (req, res) => {
    const settings = await updateOwnSettings({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      data: req.body,
    });
    res.status(200).json({ settings });
  }),
);

companyRouter.get(
  "/company/holidays",
  asyncHandler(async (req, res) => {
    const holidays = await listHolidays(req.auth!.companyId!);
    res.status(200).json({ data: holidays });
  }),
);

companyRouter.post(
  "/company/holidays",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(CreateHolidayRequestSchema),
  asyncHandler(async (req, res) => {
    const holiday = await createHoliday({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      date: req.body.date,
      name: req.body.name,
    });
    res.status(201).json({ holiday });
  }),
);

companyRouter.delete(
  "/company/holidays/:id",
  requireRole("COMPANY_ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    await deleteHoliday({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      holidayId: req.params.id!,
    });
    res.status(204).send();
  }),
);
