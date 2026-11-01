import { useQuery } from "@tanstack/react-query";
import type {
  EmployeeDto,
  LeaveApprovalDto,
  LeaveBalanceDto,
  LeaveRequestDto,
  LeaveTypeDto,
  PaginatedResponse,
} from "@employee-saas/shared";
import { api } from "./apiClient";
import { useAuth } from "./authContext";

function useHasEmployeeProfile(): boolean {
  const { status, user } = useAuth();
  return status === "authenticated" && !!user?.employeeId;
}

export function useEmployeeMe() {
  const enabled = useHasEmployeeProfile();
  return useQuery({
    queryKey: ["employee", "me"],
    queryFn: () => api.get<{ employee: EmployeeDto }>("/employees/me"),
    enabled,
    select: (res) => res.employee,
  });
}

export function useLeaveTypes() {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["leave-types"],
    queryFn: () => api.get<{ data: LeaveTypeDto[] }>("/leave-types"),
    enabled: status === "authenticated",
    select: (res) => res.data,
    staleTime: 60 * 1000,
  });
}

export function useLeaveBalances() {
  const enabled = useHasEmployeeProfile();
  return useQuery({
    queryKey: ["leave-balances", "me"],
    queryFn: () => api.get<{ data: LeaveBalanceDto[] }>("/leave-balances/me"),
    enabled,
    select: (res) => res.data,
  });
}

// Phase 1 scale (a handful of requests per employee) - fetches one page up
// to 100 rather than adding a dedicated "summary" endpoint, same tradeoff
// apps/web's dashboard/list pages already make.
export function useLeaveRequests(page: number, pageSize = 20) {
  const enabled = useHasEmployeeProfile();
  return useQuery({
    queryKey: ["leave-requests", "me", page, pageSize],
    queryFn: () => api.get<PaginatedResponse<LeaveRequestDto>>(`/leave-requests/me?page=${page}&pageSize=${pageSize}`),
    enabled,
  });
}

export function useLeaveRequestDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["leave-request", id],
    queryFn: () => api.get<{ leaveRequest: LeaveRequestDto; approvals: LeaveApprovalDto[] }>(`/leave-requests/${id}`),
    enabled: !!id,
  });
}
