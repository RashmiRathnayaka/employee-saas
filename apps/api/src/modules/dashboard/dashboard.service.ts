import type { AdminDashboardSummary, ManagerDashboardSummary } from "@employee-saas/shared";
import { ApiError } from "../../lib/errors.js";
import { platformPrisma } from "../../lib/prisma.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { getTodayInTimezone } from "../../lib/leaveDays.js";

function toUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export async function getAdminDashboardSummary(companyId: string): Promise<AdminDashboardSummary> {
  const tenant = getTenantPrisma(companyId);
  const company = await platformPrisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new ApiError(500, "INTERNAL_ERROR", "Company not found.");
  const today = toUtcDate(getTodayInTimezone(company.timezone));

  const [activeEmployees, pendingLeaveRequests, proofsOverdue, onLeaveToday] = await Promise.all([
    tenant.employee.count({ where: { status: "ACTIVE" } }),
    tenant.leaveRequest.count({ where: { status: { in: ["PENDING_MANAGER", "PENDING_HR"] } } }),
    tenant.leaveRequest.count({ where: { proofStatus: { in: ["MISSING", "INFO_REQUIRED"] } } }),
    tenant.leaveRequest.count({ where: { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } } }),
  ]);

  return { scope: "ADMIN", activeEmployees, pendingLeaveRequests, proofsOverdue, onLeaveToday };
}

export async function getManagerDashboardSummary(params: {
  companyId: string;
  managerEmployeeId: string;
}): Promise<ManagerDashboardSummary> {
  const tenant = getTenantPrisma(params.companyId);
  const company = await platformPrisma.company.findUnique({ where: { id: params.companyId } });
  if (!company) throw new ApiError(500, "INTERNAL_ERROR", "Company not found.");
  const today = toUtcDate(getTodayInTimezone(company.timezone));

  const [teamPendingRequests, teamOnLeaveToday] = await Promise.all([
    tenant.leaveRequest.count({
      where: { employee: { managerId: params.managerEmployeeId }, status: { in: ["PENDING_MANAGER", "PENDING_HR"] } },
    }),
    tenant.leaveRequest.count({
      where: {
        employee: { managerId: params.managerEmployeeId },
        status: "APPROVED",
        startDate: { lte: today },
        endDate: { gte: today },
      },
    }),
  ]);

  return { scope: "MANAGER", teamPendingRequests, teamOnLeaveToday };
}
