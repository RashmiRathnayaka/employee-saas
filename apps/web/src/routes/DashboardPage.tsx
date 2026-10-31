import { useQuery } from "@tanstack/react-query";
import type { DashboardSummary } from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { ErrorState } from "../components/ErrorState";
import { api } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { strings } from "../strings";

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 p-4">
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const hasSummary = user?.role === "COMPANY_ADMIN" || user?.role === "HR" || user?.role === "MANAGER";

  const summaryQuery = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
    enabled: hasSummary,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600">
            Signed in as <strong>{user?.email ?? user?.id}</strong> ({user?.role.replace("_", " ")}).
          </p>
        </CardContent>
      </Card>

      {hasSummary ? (
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryQuery.isLoading ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : summaryQuery.isError || !summaryQuery.data ? (
              <ErrorState message={strings.common.somethingWentWrong} onRetry={() => summaryQuery.refetch()} />
            ) : summaryQuery.data.scope === "ADMIN" ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatTile label={strings.dashboard.activeEmployees} value={summaryQuery.data.activeEmployees} />
                <StatTile label={strings.dashboard.pendingRequests} value={summaryQuery.data.pendingLeaveRequests} />
                <StatTile label={strings.dashboard.proofsOverdue} value={summaryQuery.data.proofsOverdue} />
                <StatTile label={strings.dashboard.onLeaveToday} value={summaryQuery.data.onLeaveToday} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatTile label={strings.dashboard.teamPending} value={summaryQuery.data.teamPendingRequests} />
                <StatTile label={strings.dashboard.teamOnLeaveToday} value={summaryQuery.data.teamOnLeaveToday} />
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
