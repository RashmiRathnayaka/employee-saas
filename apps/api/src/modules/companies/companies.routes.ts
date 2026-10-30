import { Router } from "express";
import type { Company } from "@prisma/client";
import { CreateCompanyRequestSchema, PaginationQuerySchema, UpdateCompanyStatusRequestSchema, type CompanyDto } from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { createCompany, getCompanyById, listCompanies, updateCompanyStatus } from "./companies.service.js";

export const companiesRouter = Router();

function toCompanyDto(company: Company): CompanyDto {
  return {
    id: company.id,
    name: company.name,
    code: company.code,
    status: company.status,
    timezone: company.timezone,
    logoUrl: company.logoUrl,
    createdAt: company.createdAt.toISOString(),
  };
}

// Every route here is platform-admin-only.
companiesRouter.use("/companies", requireAuth, requireRole("SUPER_ADMIN"));

companiesRouter.post(
  "/companies",
  validateBody(CreateCompanyRequestSchema),
  asyncHandler(async (req, res) => {
    const { name, code, adminEmail } = req.body;
    const { company, admin, temporaryPassword } = await createCompany({
      name,
      code,
      adminEmail,
      actorUserId: req.auth!.userId,
    });
    res.status(201).json({
      company: toCompanyDto(company),
      admin: { id: admin.id, email: admin.email },
      temporaryPassword,
    });
  }),
);

companiesRouter.get(
  "/companies",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = PaginationQuerySchema.parse(req.query);
    const { data, total } = await listCompanies({ page, pageSize });
    res.status(200).json({ data: data.map(toCompanyDto), page, pageSize, total });
  }),
);

companiesRouter.get(
  "/companies/:id",
  asyncHandler(async (req, res) => {
    const company = await getCompanyById(req.params.id!);
    res.status(200).json({ company: toCompanyDto(company) });
  }),
);

companiesRouter.patch(
  "/companies/:id/status",
  validateBody(UpdateCompanyStatusRequestSchema),
  asyncHandler(async (req, res) => {
    const company = await updateCompanyStatus({
      id: req.params.id!,
      status: req.body.status,
      actorUserId: req.auth!.userId,
    });
    res.status(200).json({ company: toCompanyDto(company) });
  }),
);
