import { z } from "zod";

export const AdminDashboardSummarySchema = z.object({
  scope: z.literal("ADMIN"),
  activeEmployees: z.number(),
  pendingLeaveRequests: z.number(),
  proofsOverdue: z.number(),
  onLeaveToday: z.number(),
});
export type AdminDashboardSummary = z.infer<typeof AdminDashboardSummarySchema>;

export const ManagerDashboardSummarySchema = z.object({
  scope: z.literal("MANAGER"),
  teamPendingRequests: z.number(),
  teamOnLeaveToday: z.number(),
});
export type ManagerDashboardSummary = z.infer<typeof ManagerDashboardSummarySchema>;

export const DashboardSummarySchema = z.discriminatedUnion("scope", [
  AdminDashboardSummarySchema,
  ManagerDashboardSummarySchema,
]);
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
