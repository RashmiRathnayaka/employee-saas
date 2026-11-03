import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { focusManager, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MarkAllReadResponse, NotificationDto, PaginatedResponse, UnreadCountResponse } from "@employee-saas/shared";
import { api } from "./apiClient";
import { useAuth } from "./authContext";

// Every notifications key starts with "notifications", so one invalidate
// refreshes the badge and the list together.
const NOTIFICATIONS_KEY = ["notifications"] as const;
export const NOTIFICATIONS_PAGE_SIZE = 20;

/**
 * TanStack Query's "window focus" concept doesn't exist in React Native on
 * its own. This tells it that the app coming back to the foreground counts
 * as "focused", so queries that opt in with `refetchOnWindowFocus: true`
 * (only the unread count does - the app-wide default is off) refetch then.
 * Mount once, in the root layout. No background polling, no push (Phase 1).
 */
export function useAppStateFocus() {
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      focusManager.setFocused(status === "active");
    });
    return () => subscription.remove();
  }, []);
}

function useCanLoadNotifications(): boolean {
  const { status, user } = useAuth();
  return status === "authenticated" && !!user?.companyId;
}

export function useUnreadNotificationCount() {
  const enabled = useCanLoadNotifications();
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, "unread-count"],
    queryFn: () => api.get<UnreadCountResponse>("/notifications/unread-count"),
    select: (res) => res.count,
    enabled,
    refetchOnWindowFocus: true,
  });
}

/** Newest first, loaded a page at a time as the list scrolls. */
export function useNotificationsList() {
  const enabled = useCanLoadNotifications();
  return useInfiniteQuery({
    queryKey: [...NOTIFICATIONS_KEY, "list"],
    queryFn: ({ pageParam }) =>
      api.get<PaginatedResponse<NotificationDto>>(`/notifications?page=${pageParam}&pageSize=${NOTIFICATIONS_PAGE_SIZE}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled,
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
