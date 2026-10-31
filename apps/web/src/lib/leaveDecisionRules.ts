import type { AuthUser, LeaveRequestDto } from "@employee-saas/shared";

/**
 * Mirrors the API's decision rules (docs/permissions.md) so the UI can hide
 * Approve/Reject before the user even tries - the API is still the real
 * enforcement point regardless of what this returns.
 *
 * - Nobody may decide their own request, at any step, regardless of role.
 * - A MANAGER may only decide while the request is at the MANAGER step.
 * - HR may decide at the MANAGER step (fallback/override) or the HR step.
 * - COMPANY_ADMIN and EMPLOYEE never decide.
 */
export function canDecideLeaveRequest(request: LeaveRequestDto, user: AuthUser | null): boolean {
  if (!user) return false;
  if (user.employeeId && user.employeeId === request.employeeId) return false;

  if (user.role === "MANAGER") return request.status === "PENDING_MANAGER";
  if (user.role === "HR") return request.status === "PENDING_MANAGER" || request.status === "PENDING_HR";
  return false;
}
