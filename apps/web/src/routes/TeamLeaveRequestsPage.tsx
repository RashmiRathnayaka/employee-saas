import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EmployeeDto, LeaveTypeDto } from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Pagination } from "../components/Pagination";
import { LeaveRequestsTable } from "../components/LeaveRequestsTable";
import { api } from "../lib/apiClient";
import { useLeaveRequestsList, type LeaveRequestsTab } from "../lib/useLeaveRequestsList";
import { strings } from "../strings";

export function TeamLeaveRequestsPage() {
  const [tab, setTab] = useState<LeaveRequestsTab>("pending");
  const [page, setPage] = useState(1);

  const { data: leaveTypes } = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => api.get<{ data: LeaveTypeDto[] }>("/leave-types"),
    select: (res) => res.data,
    staleTime: 60 * 1000,
  });
  const { data: team } = useQuery({
    queryKey: ["employees"],
    queryFn: () => api.get<{ data: EmployeeDto[] }>("/employees?pageSize=100"),
    select: (res) => res.data,
    staleTime: 60 * 1000,
  });

  const list = useLeaveRequestsList({ path: "/leave-requests/team", tab, page });

  function onTabChange(value: string) {
    setTab(value as LeaveRequestsTab);
    setPage(1);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{strings.leaveRequests.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={onTabChange}>
          <TabsList>
            <TabsTrigger value="pending">{strings.leaveRequests.tabPending}</TabsTrigger>
            <TabsTrigger value="approved">{strings.leaveRequests.tabApproved}</TabsTrigger>
            <TabsTrigger value="rejected">{strings.leaveRequests.tabRejected}</TabsTrigger>
            <TabsTrigger value="all">{strings.leaveRequests.tabAll}</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            {list.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : list.isError ? (
              <ErrorState message={strings.common.somethingWentWrong} onRetry={() => list.refetch()} />
            ) : list.data.length === 0 ? (
              <EmptyState title={strings.leaveRequests.noRequests} />
            ) : (
              <>
                <LeaveRequestsTable requests={list.data} leaveTypes={leaveTypes ?? []} employees={team ?? []} />
                {tab !== "pending" ? (
                  <Pagination page={page} pageSize={list.pageSize} total={list.total} onPageChange={setPage} />
                ) : null}
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
