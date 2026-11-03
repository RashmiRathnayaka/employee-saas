import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MarkAllReadResponse, NotificationDto, PaginatedResponse, UnreadCountResponse } from "@employee-saas/shared";
import { api } from "./apiClient";
import { useAuth } from "./authContext";

// Every notifications query key starts with "notifications", so one
// invalidate refreshes the bell's count, the bell's list and the full page.
const NOTIFICATIONS_KEY = ["notifications"] as const;

/** SUPER_ADMIN has no company, so it has no notifications (the API answers
 * 403). Only company users poll. */
function useHasNotifications(): boolean {
  const { user } = useAuth();
  return Boolean(user?.companyId);
}

/** Unread count for the bell badge. Phase 1 has no websockets: TanStack
 * Query polls instead, every 60 seconds while the tab is visible, and again
 * as soon as the window regains focus. (The app-wide default turns
 * focus-refetch off; this query opts back in.) */
export function useUnreadNotificationCount() {
  const enabled = useHasNotifications();
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, "unread-count"],
    queryFn: () => api.get<UnreadCountResponse>("/notifications/unread-count"),
    select: (res) => res.count,
    enabled,
    refetchOnWindowFocus: true,
    refetchInterval: 60 * 1000,
  });
}

export function useNotifications(params: { page: number; pageSize: number; unreadOnly: boolean; enabled?: boolean }) {
  const hasNotifications = useHasNotifications();
  const search = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  if (params.unreadOnly) search.set("unreadOnly", "true");
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, "list", params.page, params.pageSize, params.unreadOnly],
    queryFn: () => api.get<PaginatedResponse<NotificationDto>>(`/notifications?${search.toString()}`),
    enabled: hasNotifications && (params.enabled ?? true),
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch<{ notification: NotificationDto }>(`/notifications/${id}/read`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.patch<MarkAllReadResponse>("/notifications/read-all"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}
