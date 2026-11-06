import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  OpenSiteVisitResponse,
  PaginatedResponse,
  SiteSummaryDto,
  SiteVisitWithCoordinatesDto,
} from "@employee-saas/shared";
import { api, ApiClientError } from "./apiClient";
import { getNextHistoryPage, newClientRequestId } from "./attendance";
import { readLocationForCheck } from "./location";

export const SITE_VISITS_KEY = "site-visits";
const PAGE_SIZE = 20;
const ELAPSED_REFRESH_MS = 30_000;

export function useOpenSiteVisit(enabled: boolean) {
  return useQuery({
    queryKey: [SITE_VISITS_KEY, "open"],
    queryFn: () => api.get<OpenSiteVisitResponse>("/site-visits/me/open"),
    enabled,
  });
}

export function useMyVisits(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [SITE_VISITS_KEY, "mine"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<PaginatedResponse<SiteVisitWithCoordinatesDto>>(`/site-visits/me?page=${pageParam}&pageSize=${PAGE_SIZE}`),
    getNextPageParam: getNextHistoryPage,
    enabled,
  });
}

/** Only external sites: offices are for the day's check-in (architecture-phase2 §2).
 * "Sites from my tasks first" arrives with tasks, in step 2.10. */
export function usePickableSites(search: string) {
  const q = search.trim();
  return useInfiniteQuery({
    queryKey: ["sites", "pickable", q],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ type: "EXTERNAL", page: String(pageParam), pageSize: String(PAGE_SIZE) });
      if (q) params.set("q", q);
      return api.get<PaginatedResponse<SiteSummaryDto>>(`/sites?${params.toString()}`);
    },
    getNextPageParam: getNextHistoryPage,
  });
}

export function elapsedMinutes(since: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
}

/** Whole minutes since a time, kept current while the screen is showing. It's worked
 * out from the clock each time, so it's right again as soon as the app is reopened. */
export function useElapsedMinutes(since: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_REFRESH_MS);
    return () => clearInterval(timer);
  }, [since]);
  return elapsedMinutes(since, now);
}

/** No response at all, so the phone can't know whether the server got the request. */
function reachedNoServer(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 0;
}

type CheckInTap = { siteId: string; gpsRequired: boolean };
type CheckOutTap = { visitId: string; gpsRequired: boolean };

async function locationFields(gpsRequired: boolean) {
  const location = gpsRequired ? await readLocationForCheck() : null;
  return location ? { location } : {};
}

/**
 * Checking in and out at a site, online only, for the reasons in `useAttendanceActions`.
 *
 * A check-in keeps its request id until the server has given a definite answer, so a
 * tap after a lost response gets the same visit back. The id belongs to one site: if
 * the employee then picks a different one, that's a new request, not a retry.
 *
 * A check-in can start the attendance day and a check-out can't end it, but both
 * refresh the Home card, since the visit shows in `/attendance/me/today`.
 */
export function useSiteVisitActions() {
  const queryClient = useQueryClient();
  const pendingCheckIn = useRef<{ siteId: string; id: string } | null>(null);
  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: [SITE_VISITS_KEY] }),
        queryClient.invalidateQueries({ queryKey: ["attendance"] }),
      ]),
    [queryClient],
  );

  const checkIn = useMutation({
    networkMode: "always",
    mutationFn: async ({ siteId, gpsRequired }: CheckInTap) => {
      const location = await locationFields(gpsRequired);
      if (pendingCheckIn.current?.siteId !== siteId) {
        pendingCheckIn.current = { siteId, id: newClientRequestId() };
      }
      return api.post<{ visit: SiteVisitWithCoordinatesDto }>("/site-visits/check-in", {
        siteId,
        clientRequestId: pendingCheckIn.current.id,
        ...location,
      });
    },
    onSuccess: () => {
      pendingCheckIn.current = null;
      return refresh();
    },
    onError: (error) => {
      // A 5xx may have happened after the row was saved, so that keeps the id too.
      const definite = error instanceof ApiClientError && error.status >= 400 && error.status < 500;
      if (definite) pendingCheckIn.current = null;
      return reachedNoServer(error) ? undefined : refresh();
    },
  });

  const checkOut = useMutation({
    networkMode: "always",
    mutationFn: async ({ visitId, gpsRequired }: CheckOutTap) => {
      const location = await locationFields(gpsRequired);
      return api.post<{ visit: SiteVisitWithCoordinatesDto }>(`/site-visits/${visitId}/check-out`, location);
    },
    onSuccess: refresh,
    onError: (error) => (reachedNoServer(error) ? undefined : refresh()),
  });

  return { checkIn, checkOut };
}
