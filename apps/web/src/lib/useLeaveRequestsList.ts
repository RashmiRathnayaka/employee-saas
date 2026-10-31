import { useQuery } from "@tanstack/react-query";
import type { LeaveRequestDto, PaginatedResponse } from "@employee-saas/shared";
import { api } from "./apiClient";

export type LeaveRequestsTab = "pending" | "approved" | "rejected" | "all";

const PAGE_SIZE = 20;

/**
 * The API's status filter only accepts one status at a time, but the
 * "Pending" tab means PENDING_MANAGER *or* PENDING_HR - so that tab fires
 * two requests and merges them client-side instead of paginating normally
 * (acceptable at Phase 1's scale; pagination controls are hidden for it).
 */
export function useLeaveRequestsList(params: {
  path: string;
  tab: LeaveRequestsTab;
  page: number;
  employeeId?: string;
  leaveTypeId?: string;
  proofOverdue?: boolean;
}) {
  const query = new URLSearchParams();
  query.set("pageSize", String(params.tab === "pending" ? 100 : PAGE_SIZE));
  if (params.tab === "approved") query.set("status", "APPROVED");
  if (params.tab === "rejected") query.set("status", "REJECTED");
  if (params.employeeId && params.employeeId !== "all") query.set("employeeId", params.employeeId);
  if (params.leaveTypeId && params.leaveTypeId !== "all") query.set("leaveTypeId", params.leaveTypeId);
  if (params.proofOverdue) query.set("proofOverdue", "true");
  if (params.tab !== "pending") query.set("page", String(params.page));
  const baseQueryString = query.toString();

  const pendingManager = useQuery({
    queryKey: [params.path, "pending-manager", baseQueryString],
    queryFn: () => api.get<PaginatedResponse<LeaveRequestDto>>(`${params.path}?${baseQueryString}&status=PENDING_MANAGER`),
    enabled: params.tab === "pending",
  });
  const pendingHr = useQuery({
    queryKey: [params.path, "pending-hr", baseQueryString],
    queryFn: () => api.get<PaginatedResponse<LeaveRequestDto>>(`${params.path}?${baseQueryString}&status=PENDING_HR`),
    enabled: params.tab === "pending",
  });
  const normal = useQuery({
    queryKey: [params.path, "normal", baseQueryString],
    queryFn: () => api.get<PaginatedResponse<LeaveRequestDto>>(`${params.path}?${baseQueryString}`),
    enabled: params.tab !== "pending",
  });

  if (params.tab === "pending") {
    const data = [...(pendingManager.data?.data ?? []), ...(pendingHr.data?.data ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return {
      isLoading: pendingManager.isLoading || pendingHr.isLoading,
      isError: pendingManager.isError || pendingHr.isError,
      data,
      total: data.length,
      pageSize: PAGE_SIZE,
      refetch: () => {
        pendingManager.refetch();
        pendingHr.refetch();
      },
    };
  }

  return {
    isLoading: normal.isLoading,
    isError: normal.isError,
    data: normal.data?.data ?? [],
    total: normal.data?.total ?? 0,
    pageSize: PAGE_SIZE,
    refetch: normal.refetch,
  };
}
