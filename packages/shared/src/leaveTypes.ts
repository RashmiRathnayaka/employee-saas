import { z } from "zod";

export const CreateLeaveTypeRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(20),
  defaultAnnualDays: z.number().min(0),
  requiresProof: z.boolean().default(false),
  carryForwardAllowed: z.boolean().default(false),
  allowPastDates: z.boolean().default(false),
});
export type CreateLeaveTypeRequest = z.infer<typeof CreateLeaveTypeRequestSchema>;

export const UpdateLeaveTypeRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  defaultAnnualDays: z.number().min(0).optional(),
  requiresProof: z.boolean().optional(),
  carryForwardAllowed: z.boolean().optional(),
  allowPastDates: z.boolean().optional(),
});
export type UpdateLeaveTypeRequest = z.infer<typeof UpdateLeaveTypeRequestSchema>;

export const LeaveTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  defaultAnnualDays: z.number(),
  requiresProof: z.boolean(),
  carryForwardAllowed: z.boolean(),
  allowPastDates: z.boolean(),
});
export type LeaveTypeDto = z.infer<typeof LeaveTypeSchema>;
