import { useEffect, useState } from "react";
import type { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreateLeaveRequestSchema,
  type LeaveBalanceDto,
  type LeaveRequestDto,
  type LeaveTypeDto,
  type PaginatedResponse,
  type PreviewLeaveDaysResponse,
} from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LeaveRequestsTable } from "../components/LeaveRequestsTable";
import { Pagination } from "../components/Pagination";
import { api } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { applyApiErrorToForm, getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

const PAGE_SIZE = 10;

// z.input, not z.infer - CreateLeaveRequestSchema's `.default(...)` fields
// are optional on the way in, matching react-hook-form's defaultValues shape.
type CreateLeaveRequestFormValues = z.input<typeof CreateLeaveRequestSchema>;

export function MyLeavePage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const hasEmployeeProfile = !!user?.employeeId;

  const balancesQuery = useQuery({
    queryKey: ["my-leave-balances"],
    queryFn: () => api.get<{ data: LeaveBalanceDto[] }>("/leave-balances/me"),
    enabled: hasEmployeeProfile,
  });
  const leaveTypesQuery = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => api.get<{ data: LeaveTypeDto[] }>("/leave-types"),
    staleTime: 60 * 1000,
  });
  const historyQuery = useQuery({
    queryKey: ["my-leave-history", page],
    queryFn: () => api.get<PaginatedResponse<LeaveRequestDto>>(`/leave-requests/me?page=${page}&pageSize=${PAGE_SIZE}`),
    enabled: hasEmployeeProfile,
  });

  const {
    register,
    handleSubmit,
    watch,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateLeaveRequestFormValues>({
    resolver: zodResolver(CreateLeaveRequestSchema),
    defaultValues: {
      leaveTypeId: "",
      startDate: "",
      endDate: "",
      startHalfDay: false,
      endHalfDay: false,
      reason: "",
    },
  });

  const [startDate, endDate, startHalfDay, endHalfDay] = watch(["startDate", "endDate", "startHalfDay", "endHalfDay"]);
  const debouncedRange = useDebouncedValue({ startDate, endDate, startHalfDay, endHalfDay }, 300);
  const [preview, setPreview] = useState<{ totalDays: number } | { error: string } | null>(null);

  useEffect(() => {
    if (!debouncedRange.startDate || !debouncedRange.endDate) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    api
      .post<PreviewLeaveDaysResponse>("/leave-requests/preview", debouncedRange)
      .then((res) => !cancelled && setPreview({ totalDays: res.totalDays }))
      .catch((error) => !cancelled && setPreview({ error: getErrorMessage(error) }));
    return () => {
      cancelled = true;
    };
  }, [debouncedRange]);

  const submitMutation = useMutation({
    mutationFn: (values: CreateLeaveRequestFormValues) => api.post("/leave-requests", values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-leave-balances"] }),
        queryClient.invalidateQueries({ queryKey: ["my-leave-history"] }),
      ]);
      reset();
      setPreview(null);
      toast.success(strings.myLeave.submitSuccess);
    },
    onError: (error) => {
      if (!applyApiErrorToForm(error, setError)) {
        toast.error(getErrorMessage(error));
      }
    },
  });

  if (!hasEmployeeProfile) {
    return <EmptyState title="You don't have an employee profile" description="There's no leave to show here." />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{strings.myLeave.balances}</CardTitle>
        </CardHeader>
        <CardContent>
          {balancesQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : balancesQuery.isError ? (
            <ErrorState message={strings.common.somethingWentWrong} onRetry={() => balancesQuery.refetch()} />
          ) : !balancesQuery.data || balancesQuery.data.data.length === 0 ? (
            <EmptyState title="No leave balances" />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {balancesQuery.data.data.map((balance) => {
                const leaveType = leaveTypesQuery.data?.data.find((lt) => lt.id === balance.leaveTypeId);
                return (
                  <div key={balance.id} className="rounded-md border border-slate-200 p-3">
                    <p className="text-xs uppercase text-slate-400">{leaveType?.name ?? balance.leaveTypeId}</p>
                    <p className="mt-1 text-xl font-semibold text-slate-900">{balance.availableDays}</p>
                    <p className="text-xs text-slate-500">{strings.employees.available.toLowerCase()}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{strings.myLeave.apply}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit((values) => submitMutation.mutateAsync(values))} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="leaveTypeId">{strings.myLeave.leaveType}</Label>
              <select
                id="leaveTypeId"
                className="flex h-10 w-full max-w-sm rounded-md border border-slate-300 bg-white px-3 text-sm"
                {...register("leaveTypeId")}
              >
                <option value="">-</option>
                {(leaveTypesQuery.data?.data ?? []).map((lt) => (
                  <option key={lt.id} value={lt.id}>
                    {lt.name}
                  </option>
                ))}
              </select>
              {errors.leaveTypeId ? <p className="text-sm text-red-600">{errors.leaveTypeId.message}</p> : null}
            </div>

            <div className="grid grid-cols-2 gap-4 max-w-sm">
              <div className="space-y-1.5">
                <Label htmlFor="startDate">{strings.myLeave.startDate}</Label>
                <Input id="startDate" type="date" {...register("startDate")} />
                {errors.startDate ? <p className="text-sm text-red-600">{errors.startDate.message}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="endDate">{strings.myLeave.endDate}</Label>
                <Input id="endDate" type="date" {...register("endDate")} />
                {errors.endDate ? <p className="text-sm text-red-600">{errors.endDate.message}</p> : null}
              </div>
            </div>

            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" {...register("startHalfDay")} />
                {strings.myLeave.startHalfDay}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" {...register("endHalfDay")} />
                {strings.myLeave.endHalfDay}
              </label>
            </div>

            <div className="space-y-1.5 max-w-md">
              <Label htmlFor="reason">{strings.myLeave.reason}</Label>
              <textarea id="reason" className="w-full rounded-md border border-slate-300 p-2 text-sm" rows={2} {...register("reason")} />
            </div>

            {preview ? (
              <p className="text-sm">
                {"totalDays" in preview ? (
                  <span className="font-medium text-slate-900">
                    {strings.myLeave.totalDaysPreview}: {preview.totalDays}
                  </span>
                ) : (
                  <span className="text-red-600">{preview.error}</span>
                )}
              </p>
            ) : null}

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? strings.myLeave.submitting : strings.myLeave.submit}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{strings.myLeave.history}</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : historyQuery.isError ? (
            <ErrorState message={strings.common.somethingWentWrong} onRetry={() => historyQuery.refetch()} />
          ) : !historyQuery.data || historyQuery.data.data.length === 0 ? (
            <EmptyState title={strings.leaveRequests.noRequests} />
          ) : (
            <>
              <LeaveRequestsTable requests={historyQuery.data.data} leaveTypes={leaveTypesQuery.data?.data ?? []} showEmployee={false} />
              <Pagination page={page} pageSize={PAGE_SIZE} total={historyQuery.data.total} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

