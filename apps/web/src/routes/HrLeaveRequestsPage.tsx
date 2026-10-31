import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EmployeeDto, LeaveTypeDto } from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Pagination } from "../components/Pagination";
import { LeaveRequestsTable } from "../components/LeaveRequestsTable";
import { api } from "../lib/apiClient";
import { useLeaveRequestsList, type LeaveRequestsTab } from "../lib/useLeaveRequestsList";
import { strings } from "../strings";

export function HrLeaveRequestsPage() {
  const [tab, setTab] = useState<LeaveRequestsTab>("pending");
  const [page, setPage] = useState(1);
  const [employeeId, setEmployeeId] = useState("all");
  const [leaveTypeId, setLeaveTypeId] = useState("all");
  const [proofOverdue, setProofOverdue] = useState(false);

  const { data: leaveTypes } = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => api.get<{ data: LeaveTypeDto[] }>("/leave-types"),
    select: (res) => res.data,
    staleTime: 60 * 1000,
  });
  const { data: employees } = useQuery({
    queryKey: ["employees", "all-for-filter"],
    queryFn: () => api.get<{ data: EmployeeDto[] }>("/employees?pageSize=100"),
    select: (res) => res.data,
    staleTime: 60 * 1000,
  });

  const list = useLeaveRequestsList({ path: "/leave-requests", tab, page, employeeId, leaveTypeId, proofOverdue });

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

          <div className="my-4 flex flex-wrap items-center gap-3">
            <Select
              value={employeeId}
              onValueChange={(v) => {
                setEmployeeId(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{strings.leaveRequests.filterEmployee}: all</SelectItem>
                {(employees ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={leaveTypeId}
              onValueChange={(v) => {
                setLeaveTypeId(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Leave type: all</SelectItem>
                {(leaveTypes ?? []).map((lt) => (
                  <SelectItem key={lt.id} value={lt.id}>
                    {lt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={proofOverdue}
                onChange={(e) => {
                  setProofOverdue(e.target.checked);
                  setPage(1);
                }}
              />
              {strings.leaveRequests.filterProofOverdue}
            </label>
          </div>

          <TabsContent value={tab}>
            {list.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : list.isError ? (
              <ErrorState message={strings.common.somethingWentWrong} onRetry={() => list.refetch()} />
            ) : list.data.length === 0 ? (
              <EmptyState title={strings.leaveRequests.noRequests} />
            ) : (
              <>
                <LeaveRequestsTable requests={list.data} leaveTypes={leaveTypes ?? []} employees={employees ?? []} />
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
