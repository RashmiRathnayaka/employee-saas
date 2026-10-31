import { z } from "zod";

export const CompanyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,12}$/, "Company code must be 3-12 uppercase letters or digits");

export const CompanyStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);

export const CreateCompanyRequestSchema = z.object({
  name: z.string().trim().min(1),
  code: CompanyCodeSchema,
  adminEmail: z.string().trim().email(),
});
export type CreateCompanyRequest = z.infer<typeof CreateCompanyRequestSchema>;

export const UpdateCompanyStatusRequestSchema = z.object({
  status: CompanyStatusSchema,
});
export type UpdateCompanyStatusRequest = z.infer<typeof UpdateCompanyStatusRequestSchema>;

export const CompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  status: CompanyStatusSchema,
  timezone: z.string(),
  logoUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  createdAt: z.string(),
});
export type CompanyDto = z.infer<typeof CompanySchema>;

export const UpdateCompanyProfileRequestSchema = z.object({
  name: z.string().trim().min(1).optional(),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "primaryColor must be a hex colour like #4F46E5")
    .nullable()
    .optional(),
});
export type UpdateCompanyProfileRequest = z.infer<typeof UpdateCompanyProfileRequestSchema>;

export const LeaveApprovalWorkflowSchema = z.enum(["MANAGER_ONLY", "MANAGER_THEN_HR"]);

export const UpdateCompanySettingsRequestSchema = z.object({
  leaveApprovalWorkflow: LeaveApprovalWorkflowSchema.optional(),
  sickLeaveProofDeadlineDays: z.number().int().min(0).optional(),
  gpsCheckinEnabledDefault: z.boolean().optional(),
  gpsRadiusMeters: z.number().int().min(0).optional(),
  employeeIdPrefix: z.string().trim().min(1).max(20).optional(),
  enabledModules: z.record(z.boolean()).optional(),
  workingDays: z.record(z.enum(["FULL", "HALF", "OFF"])).optional(),
});
export type UpdateCompanySettingsRequest = z.infer<typeof UpdateCompanySettingsRequestSchema>;

export const CreateHolidayRequestSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  name: z.string().trim().min(1),
});
export type CreateHolidayRequest = z.infer<typeof CreateHolidayRequestSchema>;
