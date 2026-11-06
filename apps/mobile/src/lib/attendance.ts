import { useCallback, useRef } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isModuleEnabled,
  type AttendanceRecordWithCoordinatesDto,
  type AttendanceTodayDto,
  type CompanyModule,
  type CompanySettingsDto,
  type PaginatedResponse,
} from "@employee-saas/shared";
import { api, ApiClientError } from "./apiClient";
import { useAuth } from "./authContext";
import { getErrorMessage } from "./errorMapping";
import { strings } from "../strings";

const HISTORY_PAGE_SIZE = 20;
const ATTENDANCE_KEY = "attendance";

/** The company's module switches. Screens hide what's off; the API enforces it. */
export function useIsModuleEnabled(module: CompanyModule): boolean {
  const { status } = useAuth();
  const { data } = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => api.get<{ settings: CompanySettingsDto }>("/company/settings"),
    enabled: status === "authenticated",
    staleTime: 60 * 1000,
    select: (res) => res.settings,
  });
  return isModuleEnabled(data, module);
}

export function useAttendanceToday(enabled: boolean) {
  return useQuery({
    queryKey: [ATTENDANCE_KEY, "today"],
    queryFn: () => api.get<AttendanceTodayDto>("/attendance/me/today"),
    enabled,
  });
}

export function getNextHistoryPage(last: { page: number; pageSize: number; total: number }): number | undefined {
  return last.page * last.pageSize < last.total ? last.page + 1 : undefined;
}

export function useAttendanceHistory(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [ATTENDANCE_KEY, "history"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<PaginatedResponse<AttendanceRecordWithCoordinatesDto>>(
        `/attendance/me?page=${pageParam}&pageSize=${HISTORY_PAGE_SIZE}`,
      ),
    getNextPageParam: getNextHistoryPage,
    enabled,
  });
}

/** Good enough for what it's for: telling one tap's retries apart from another tap,
 * for one employee. It isn't a secret and nothing relies on it being unguessable,
 * so it doesn't need a crypto library. */
export function newClientRequestId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

/** No response at all, so the phone can't know whether the server got the request. */
function reachedNoServer(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 0;
}

/** What to tell the employee. Attendance is online only, and says so plainly. */
export function getAttendanceErrorMessage(error: unknown): string {
  return reachedNoServer(error) ? strings.attendance.offline : getErrorMessage(error);
}

/**
 * Check-in and check-out.
 *
 * Online only: `networkMode: "always"` makes a tap with no connection fail straight
 * away. React Query's default is to pause and quietly send it later, which would be
 * exactly the offline queue this feature must not have, because a check-in sent
 * later wouldn't be at the time the employee tapped.
 *
 * A check-in keeps its request id until the server has given a definite answer. If
 * the response was lost, the next tap resends the same id and gets the same record
 * back, rather than an "already checked in" error for a check-in that worked.
 *
 * Each mutation stays pending until the card has refreshed, so a double tap can't
 * land on the "Check out" button that replaces "Check in".
 */
export function useAttendanceActions() {
  const queryClient = useQueryClient();
  const pendingCheckInId = useRef<string | null>(null);
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: [ATTENDANCE_KEY] }), [queryClient]);

  const checkIn = useMutation({
    networkMode: "always",
    mutationFn: () => {
      pendingCheckInId.current ??= newClientRequestId();
      return api.post<{ record: AttendanceRecordWithCoordinatesDto }>("/attendance/check-in", {
        clientRequestId: pendingCheckInId.current,
        clientTime: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      pendingCheckInId.current = null;
      return refresh();
    },
    onError: (error) => {
      // A 5xx may have happened after the row was saved, so that keeps the id too.
      const definite = error instanceof ApiClientError && error.status >= 400 && error.status < 500;
      if (definite) pendingCheckInId.current = null;
      return reachedNoServer(error) ? undefined : refresh();
    },
  });

  const checkOut = useMutation({
    networkMode: "always",
    mutationFn: () =>
      api.post<{ record: AttendanceRecordWithCoordinatesDto }>("/attendance/check-out", {
        clientTime: new Date().toISOString(),
      }),
    onSuccess: refresh,
    onError: (error) => (reachedNoServer(error) ? undefined : refresh()),
  });

  return { checkIn, checkOut };
}
