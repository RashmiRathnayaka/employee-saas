import { z } from "zod";
import { RoleSchema } from "./roles.js";

const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const CreateLeaveRequestSchema = z.object({
  leaveTypeId: z.string(),
  startDate: isoDate,
  endDate: isoDate,
  startHalfDay: z.boolean().default(false),
  endHalfDay: z.boolean().default(false),
  reason: z.string().trim().max(1000).optional(),
});
export type CreateLeaveRequest = z.infer<typeof CreateLeaveRequestSchema>;

export const PreviewLeaveDaysRequestSchema = z.object({
  startDate: isoDate,
  endDate: isoDate,
  startHalfDay: z.boolean().default(false),
  endHalfDay: z.boolean().default(false),
});
export type PreviewLeaveDaysRequest = z.infer<typeof PreviewLeaveDaysRequestSchema>;

export const PreviewLeaveDaysResponseSchema = z.object({ totalDays: z.number() });
export type PreviewLeaveDaysResponse = z.infer<typeof PreviewLeaveDaysResponseSchema>;

export const DecideLeaveRequestSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type DecideLeaveRequest = z.infer<typeof DecideLeaveRequestSchema>;

export const RevokeLeaveRequestSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type RevokeLeaveRequest = z.infer<typeof RevokeLeaveRequestSchema>;

export const LeaveRequestStatusSchema = z.enum([
  "PENDING_MANAGER",
  "PENDING_HR",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "REVOKED",
]);

export const LeaveRequestListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: LeaveRequestStatusSchema.optional(),
  // Only honoured on /leave-requests (COMPANY_ADMIN, HR) and /leave-requests/team
  // (MANAGER, further narrowed to their own direct reports either way).
  employeeId: z.string().optional(),
  leaveTypeId: z.string().optional(),
  fromDate: isoDate.optional(),
  toDate: isoDate.optional(),
  // "Needs attention" shorthand: proofStatus is MISSING or INFO_REQUIRED.
  // A plain `z.coerce.boolean()` would treat the string "false" as truthy
  // (Boolean("false") === true), so this matches the literal "true" string
  // a query param actually carries instead.
  proofOverdue: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type LeaveRequestListQuery = z.infer<typeof LeaveRequestListQuerySchema>;

export const LeaveRequestSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  employeeId: z.string(),
  leaveTypeId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startHalfDay: z.boolean(),
  endHalfDay: z.boolean(),
  totalDays: z.number(),
  reason: z.string().nullable(),
  status: LeaveRequestStatusSchema,
  proofStatus: z.enum(["NOT_REQUIRED", "MISSING", "SUBMITTED", "ACCEPTED", "REJECTED", "INFO_REQUIRED"]),
  proofDueAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokeNote: z.string().nullable(),
  createdAt: z.string(),
});
export type LeaveRequestDto = z.infer<typeof LeaveRequestSchema>;

export const LeaveApprovalSchema = z.object({
  id: z.string(),
  step: z.enum(["MANAGER", "HR"]),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().nullable(),
  decidedAt: z.string(),
  approver: z.object({ id: z.string(), email: z.string().nullable(), role: RoleSchema }),
});
export type LeaveApprovalDto = z.infer<typeof LeaveApprovalSchema>;
