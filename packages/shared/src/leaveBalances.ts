import { z } from "zod";

export const LeaveBalanceSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  leaveTypeId: z.string(),
  year: z.number(),
  allocatedDays: z.number(),
  usedDays: z.number(),
  pendingDays: z.number(),
  carriedOverDays: z.number(),
  availableDays: z.number(),
});
export type LeaveBalanceDto = z.infer<typeof LeaveBalanceSchema>;

export const AdjustLeaveBalanceRequestSchema = z.object({
  leaveTypeId: z.string(),
  year: z.number().int().min(2000).max(2100),
  allocatedDays: z.number().min(0).optional(),
  usedDays: z.number().min(0).optional(),
  carriedOverDays: z.number().min(0).optional(),
  note: z.string().trim().min(1).max(500),
});
export type AdjustLeaveBalanceRequest = z.infer<typeof AdjustLeaveBalanceRequestSchema>;
