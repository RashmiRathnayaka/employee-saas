import { z } from "zod";

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
