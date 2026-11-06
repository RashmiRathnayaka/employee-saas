import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatTime,
  SiteVisitListQuerySchema,
  type PaginatedResponse,
  type SiteSummaryDto,
  type SiteVisitDto,
  type SiteVisitFlag,
} from "@employee-saas/shared";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Pagination } from "../components/Pagination";
import { StatusBadge } from "../components/StatusBadge";
import { VisitDetailDialog } from "../components/VisitDetailDialog";
import { api, ApiClientError } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { useCompany } from "../lib/companyContext";
import { strings } from "../strings";

const PAGE_SIZE = 20;
const ON_SITE_LIMIT = 100;
const REFRESH_MS = 60_000;

/** "Were they at the site?" It's the only location anyone sees in a list: exact
 * positions are for the detail view, and never for managers. */
function locationText(distanceM: number | null, withinRadius: boolean | null): string {
  if (distanceM === null) return strings.siteVisits.notChecked;
  return `${formatDistance(distanceM)}, ${withinRadius ? strings.siteVisits.within : strings.siteVisits.outside}`;
}

function Flags({ flags }: { flags: SiteVisitFlag[] }) {
  if (flags.length === 0) return <span className="text-slate-400">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <span key={flag} className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          {strings.siteVisits.flags[flag]}
        </span>
      ))}
    </div>
  );
}

function Person({ visit }: { visit: SiteVisitDto }) {
  return (
    <>
      <p className="font-medium text-slate-900">{visit.employeeName}</p>
      <p className="text-xs text-slate-500">{visit.employeeCode}</p>
    </>
  );
}

function RowsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** Only for those allowed exact positions: a manager's rows have no way in to the detail. */
function DetailsButton({ visit, onOpen }: { visit: SiteVisitDto; onOpen?: ((visitId: string) => void) | undefined }) {
  if (!onOpen) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label={`${strings.siteVisits.details}: ${visit.employeeName}, ${visit.siteName}`}
      onClick={() => onOpen(visit.id)}
    >
      {strings.siteVisits.details}
    </Button>
  );
}

function CorrectedChip({ visit }: { visit: SiteVisitDto }) {
  if (!visit.isCorrected) return null;
  return <p className="mt-1 text-xs font-medium text-amber-700">{strings.siteVisits.corrected}</p>;
}

function OnSiteNow({ endpoint, onOpen }: { endpoint: string; onOpen?: ((visitId: string) => void) | undefined }) {
  const { timezone } = useCompany();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["site-visits", endpoint, "open"],
    queryFn: () => api.get<PaginatedResponse<SiteVisitDto>>(`${endpoint}?openOnly=true&pageSize=${ON_SITE_LIMIT}`),
    refetchInterval: REFRESH_MS,
  });

  // How long they've been there moves on even when no row has changed.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>
          {strings.siteVisits.onSiteNow}
          {data ? ` (${data.total})` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <RowsSkeleton />
        ) : error ? (
          <ErrorState message={strings.common.somethingWentWrong} onRetry={() => refetch()} />
        ) : !data || data.data.length === 0 ? (
          <EmptyState title={strings.siteVisits.nobodyOnSite} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2 pr-4">{strings.siteVisits.employee}</th>
                  <th className="py-2 pr-4">{strings.siteVisits.site}</th>
                  <th className="py-2 pr-4">{strings.siteVisits.since}</th>
                  <th className="py-2 pr-4">{strings.siteVisits.timeThere}</th>
                  <th className="py-2 pr-4">{strings.siteVisits.location}</th>
                  <th className="py-2 pr-4">{strings.siteVisits.flagsTitle}</th>
                  {onOpen ? <th className="py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {data.data.map((visit) => (
                  <tr key={visit.id} className="border-b border-slate-100">
                    <td className="py-2.5 pr-4">
                      <Person visit={visit} />
                      <CorrectedChip visit={visit} />
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600">{visit.siteName}</td>
                    <td className="py-2.5 pr-4 text-slate-600">
                      {formatDate(visit.workDate, timezone)}, {formatTime(visit.checkInAt, timezone)}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600">
                      {formatDuration(Math.max(0, Math.floor((now - new Date(visit.checkInAt).getTime()) / 60_000)))}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600">{locationText(visit.checkInDistanceM, visit.checkInWithinRadius)}</td>
                    <td className="py-2.5 pr-4">
                      <Flags flags={visit.flags} />
                    </td>
                    {onOpen ? (
                      <td className="py-2.5 text-right">
                        <DetailsButton visit={visit} onOpen={onOpen} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function History({ endpoint, onOpen }: { endpoint: string; onOpen?: ((visitId: string) => void) | undefined }) {
  const { timezone } = useCompany();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [siteId, setSiteId] = useState("all");
  const [page, setPage] = useState(1);

  // The server's own rule, so the page can explain a bad range rather than fail on it.
  const parsed = SiteVisitListQuerySchema.safeParse({ from: from || undefined, to: to || undefined });
  const rangeError = parsed.success ? null : (parsed.error.issues[0]?.message ?? null);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (siteId !== "all") params.set("siteId", siteId);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["site-visits", endpoint, "history", { page, from, to, siteId }],
    queryFn: () => api.get<PaginatedResponse<SiteVisitDto>>(`${endpoint}?${params.toString()}`),
    enabled: parsed.success,
    refetchInterval: REFRESH_MS,
  });

  const sitesQuery = useQuery({
    queryKey: ["sites", "for-filter"],
    queryFn: () => api.get<PaginatedResponse<SiteSummaryDto>>("/sites?type=EXTERNAL&pageSize=100"),
    staleTime: 60_000,
  });

  const filtering = !!from || !!to || siteId !== "all";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{strings.siteVisits.history}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="visits-from">{strings.siteVisits.from}</Label>
            <Input
              id="visits-from"
              type="date"
              className="w-44"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="visits-to">{strings.siteVisits.to}</Label>
            <Input
              id="visits-to"
              type="date"
              className="w-44"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            value={siteId}
            onValueChange={(value) => {
              setSiteId(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-56" aria-label={strings.siteVisits.site}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{strings.siteVisits.allSites}</SelectItem>
              {sitesQuery.data?.data.map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {rangeError ? (
          <p role="alert" className="text-sm text-red-600">
            {rangeError}
          </p>
        ) : isLoading ? (
          <RowsSkeleton />
        ) : error ? (
          <ErrorState message={strings.common.somethingWentWrong} onRetry={() => refetch()} />
        ) : !data || data.data.length === 0 ? (
          <EmptyState title={filtering ? strings.siteVisits.noMatches : strings.siteVisits.noVisits} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="py-2 pr-4">{strings.siteVisits.employee}</th>
                    <th className="py-2 pr-4">{strings.siteVisits.site}</th>
                    <th className="py-2 pr-4">{strings.siteVisits.date}</th>
                    <th className="py-2 pr-4">{strings.siteVisits.checkIn}</th>
                    <th className="py-2 pr-4">{strings.siteVisits.checkOut}</th>
                    <th className="py-2 pr-4">{strings.siteVisits.duration}</th>
                    <th className="py-2 pr-4">{strings.siteVisits.location}</th>
                    <th className="py-2 pr-4">{strings.table.status}</th>
                    <th className="py-2 pr-4">{strings.siteVisits.flagsTitle}</th>
                    {onOpen ? <th className="py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((visit) => (
                    <tr key={visit.id} className="border-b border-slate-100">
                      <td className="py-2.5 pr-4">
                        <Person visit={visit} />
                        <CorrectedChip visit={visit} />
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">{visit.siteName}</td>
                      <td className="py-2.5 pr-4 text-slate-600">{formatDate(visit.workDate, timezone)}</td>
                      <td className="py-2.5 pr-4 text-slate-600">{formatTime(visit.checkInAt, timezone)}</td>
                      <td className="py-2.5 pr-4 text-slate-600">{visit.checkOutAt ? formatTime(visit.checkOutAt, timezone) : "-"}</td>
                      <td className="py-2.5 pr-4 text-slate-600">
                        {visit.durationMinutes !== null ? formatDuration(visit.durationMinutes) : "-"}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">{locationText(visit.checkInDistanceM, visit.checkInWithinRadius)}</td>
                      <td className="py-2.5 pr-4">
                        <StatusBadge status={visit.status} />
                      </td>
                      <td className="py-2.5 pr-4">
                        <Flags flags={visit.flags} />
                      </td>
                      {onOpen ? (
                        <td className="py-2.5 text-right">
                          <DetailsButton visit={visit} onOpen={onOpen} />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Who's on site now, and who has been. A manager sees their team, and HR and Company
 * Admin see the whole company: the API decides, and this only picks the endpoint. */
export function SiteVisitsPage() {
  const { user } = useAuth();
  const endpoint = user?.role === "MANAGER" ? "/site-visits/team" : "/site-visits";
  // Exact positions are for HR and Company Admin (Q7). A manager never gets a way in.
  const seesPositions = user?.role === "HR" || user?.role === "COMPANY_ADMIN";
  const [openVisitId, setOpenVisitId] = useState<string | null>(null);
  const onOpen = seesPositions ? setOpenVisitId : undefined;

  // Asked separately from the lists so that a switched-off module shows one message.
  const moduleCheck = useQuery({
    queryKey: ["site-visits", endpoint, "module-check"],
    queryFn: () => api.get<PaginatedResponse<SiteVisitDto>>(`${endpoint}?pageSize=1`),
    enabled: !!user,
  });

  if (moduleCheck.error instanceof ApiClientError && moduleCheck.error.code === "MODULE_DISABLED") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{strings.siteVisits.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState title={strings.sites.moduleOff} description={strings.sites.moduleOffHint} />
        </CardContent>
      </Card>
    );
  }

  if (!user) return null;

  return (
    <>
      <OnSiteNow endpoint={endpoint} onOpen={onOpen} />
      <History endpoint={endpoint} onOpen={onOpen} />
      {seesPositions && openVisitId ? <VisitDetailDialog visitId={openVisitId} onClose={() => setOpenVisitId(null)} /> : null}
    </>
  );
}
