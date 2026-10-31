import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  UpdateEmployeeRequestSchema,
  type EmployeeDto,
  type LeaveBalanceDto,
  type LeaveRequestDto,
  type LeaveTypeDto,
  type PaginatedResponse,
  type UpdateEmployeeRequest,
} from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TempPasswordDialog } from "../components/TempPasswordDialog";
import { AdjustBalanceDialog } from "../components/AdjustBalanceDialog";
import { api } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { useCompany } from "../lib/companyContext";
import { useDepartments, useDesignations, useManagerOptions } from "../lib/queries";
import { formatDate } from "../lib/formatDate";
import { getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const employeeId = id!;
  const { user } = useAuth();
  const { timezone } = useCompany();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [adjustingBalance, setAdjustingBalance] = useState<LeaveBalanceDto | null>(null);

  const canManage = user?.role === "COMPANY_ADMIN" || user?.role === "HR";
  const isSelf = user?.employeeId === employeeId;

  const employeeQuery = useQuery({
    queryKey: ["employee", employeeId],
    queryFn: () => api.get<{ employee: EmployeeDto }>(`/employees/${employeeId}`),
  });

  const balancesQuery = useQuery({
    queryKey: ["employee", employeeId, "leave-balances"],
    queryFn: () => api.get<{ data: LeaveBalanceDto[] }>(`/employees/${employeeId}/leave-balances`),
  });

  const leaveTypesQuery = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => api.get<{ data: LeaveTypeDto[] }>("/leave-types"),
    staleTime: 60 * 1000,
  });

  const historyPath = isSelf
    ? "/leave-requests/me"
    : user?.role === "MANAGER"
      ? `/leave-requests/team?employeeId=${employeeId}`
      : `/leave-requests?employeeId=${employeeId}`;

  const historyQuery = useQuery({
    queryKey: ["employee", employeeId, "leave-history"],
    queryFn: () => api.get<PaginatedResponse<LeaveRequestDto>>(historyPath),
    enabled: isSelf || canManage || user?.role === "MANAGER",
  });

  const { data: departments } = useDepartments();
  const { data: designations } = useDesignations();
  const { data: managers } = useManagerOptions();

  const statusMutation = useMutation({
    mutationFn: (status: "ACTIVE" | "INACTIVE") => api.patch(`/employees/${employeeId}/status`, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
      setStatusDialogOpen(false);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (userId: string) => api.post<{ temporaryPassword: string }>(`/users/${userId}/reset-password`),
    onSuccess: (res) => {
      setTemporaryPassword(res.temporaryPassword);
      setResetPasswordOpen(false);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
      setResetPasswordOpen(false);
    },
  });

  if (employeeQuery.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (employeeQuery.isError || !employeeQuery.data) {
    return <ErrorState message={strings.common.somethingWentWrong} onRetry={() => employeeQuery.refetch()} />;
  }

  const employee = employeeQuery.data.employee;
  const departmentName = departments?.find((d) => d.id === employee.departmentId)?.name ?? "-";
  const designationName = designations?.find((d) => d.id === employee.designationId)?.name ?? "-";
  const managerName = (() => {
    const manager = managers?.find((m) => m.id === employee.managerId);
    return manager ? `${manager.firstName} ${manager.lastName}` : "-";
  })();
  const leaveTypeNameById = new Map((leaveTypesQuery.data?.data ?? []).map((lt) => [lt.id, lt.name]));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle>
              {employee.firstName} {employee.lastName}
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">{employee.employeeCode}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={employee.status} />
            {canManage ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setEditing((v) => !v)}>
                  {editing ? strings.common.cancel : strings.employees.edit}
                </Button>
                {employee.userId ? (
                  <Button variant="secondary" size="sm" onClick={() => setResetPasswordOpen(true)}>
                    {strings.employees.resetPassword}
                  </Button>
                ) : null}
                <Button
                  variant={employee.status === "ACTIVE" ? "destructive" : "primary"}
                  size="sm"
                  onClick={() => setStatusDialogOpen(true)}
                >
                  {employee.status === "ACTIVE" ? strings.employees.deactivate : strings.employees.reactivate}
                </Button>
              </>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {editing ? (
            <EditEmployeeForm
              employee={employee}
              departments={departments ?? []}
              designations={designations ?? []}
              managers={(managers ?? []).filter((m) => m.id !== employee.id)}
              onDone={() => setEditing(false)}
            />
          ) : (
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Field label={strings.employees.phone} value={employee.phone ?? "-"} />
              <Field label={strings.employees.department} value={departmentName} />
              <Field label={strings.employees.designation} value={designationName} />
              <Field label={strings.employees.manager} value={managerName} />
              <Field label={strings.employees.joiningDate} value={formatDate(employee.joiningDate, timezone)} />
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{strings.employees.leaveBalances}</CardTitle>
        </CardHeader>
        <CardContent>
          {balancesQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : balancesQuery.isError ? (
            <ErrorState message={strings.common.somethingWentWrong} onRetry={() => balancesQuery.refetch()} />
          ) : !balancesQuery.data || balancesQuery.data.data.length === 0 ? (
            <EmptyState title="No leave balances" />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2">Leave type</th>
                  <th className="py-2">{strings.employees.available}</th>
                  <th className="py-2">{strings.employees.used}</th>
                  <th className="py-2">{strings.employees.pending}</th>
                  {canManage ? <th className="py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {balancesQuery.data.data.map((balance) => (
                  <tr key={balance.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 font-medium text-slate-900">
                      {leaveTypeNameById.get(balance.leaveTypeId) ?? balance.leaveTypeId}
                    </td>
                    <td className="py-2.5">{balance.availableDays}</td>
                    <td className="py-2.5">{balance.usedDays}</td>
                    <td className="py-2.5">{balance.pendingDays}</td>
                    {canManage ? (
                      <td className="py-2.5 text-right">
                        <Button variant="secondary" size="sm" onClick={() => setAdjustingBalance(balance)}>
                          {strings.employees.adjustBalance}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{strings.employees.leaveHistory}</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : historyQuery.isError ? (
            <ErrorState message={strings.common.somethingWentWrong} onRetry={() => historyQuery.refetch()} />
          ) : !historyQuery.data || historyQuery.data.data.length === 0 ? (
            <EmptyState title="No leave requests yet" />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2">Leave type</th>
                  <th className="py-2">Dates</th>
                  <th className="py-2">Days</th>
                  <th className="py-2">{strings.table.status}</th>
                </tr>
              </thead>
              <tbody>
                {historyQuery.data.data.map((request) => (
                  <tr key={request.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 text-slate-900">{leaveTypeNameById.get(request.leaveTypeId) ?? "-"}</td>
                    <td className="py-2.5 text-slate-600">
                      {formatDate(request.startDate, timezone)} - {formatDate(request.endDate, timezone)}
                    </td>
                    <td className="py-2.5 text-slate-600">{request.totalDays}</td>
                    <td className="py-2.5">
                      <StatusBadge status={request.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        title={employee.status === "ACTIVE" ? strings.employees.deactivate : strings.employees.reactivate}
        description={employee.status === "ACTIVE" ? strings.employees.deactivateConfirm : strings.employees.reactivateConfirm}
        destructive={employee.status === "ACTIVE"}
        onConfirm={() => statusMutation.mutateAsync(employee.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}
      />

      <ConfirmDialog
        open={resetPasswordOpen}
        onOpenChange={setResetPasswordOpen}
        title={strings.employees.resetPassword}
        description={strings.employees.resetPasswordConfirm}
        destructive={false}
        onConfirm={() => employee.userId && resetPasswordMutation.mutateAsync(employee.userId)}
      />

      <TempPasswordDialog open={!!temporaryPassword} onOpenChange={() => setTemporaryPassword(null)} password={temporaryPassword} />

      {adjustingBalance ? (
        <AdjustBalanceDialog
          open
          onOpenChange={(open) => !open && setAdjustingBalance(null)}
          employeeId={employee.id}
          balance={adjustingBalance}
          leaveType={leaveTypesQuery.data?.data.find((lt) => lt.id === adjustingBalance.leaveTypeId)}
        />
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{value}</dd>
    </div>
  );
}

function EditEmployeeForm({
  employee,
  departments,
  designations,
  managers,
  onDone,
}: {
  employee: EmployeeDto;
  departments: { id: string; name: string }[];
  designations: { id: string; name: string }[];
  managers: { id: string; firstName: string; lastName: string }[];
  onDone: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<UpdateEmployeeRequest>({
    resolver: zodResolver(UpdateEmployeeRequestSchema),
    defaultValues: {
      firstName: employee.firstName,
      lastName: employee.lastName,
      phone: employee.phone,
      departmentId: employee.departmentId,
      designationId: employee.designationId,
      managerId: employee.managerId,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: UpdateEmployeeRequest) => api.patch(`/employees/${employee.id}`, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["employee", employee.id] });
      toast.success(strings.common.save);
      onDone();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <form className="space-y-4" onSubmit={handleSubmit((values) => mutation.mutateAsync(values))}>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="firstName">{strings.employees.firstName}</Label>
          <Input id="firstName" {...register("firstName")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName">{strings.employees.lastName}</Label>
          <Input id="lastName" {...register("lastName")} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">{strings.employees.phone}</Label>
        <Input id="phone" {...register("phone")} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label>{strings.employees.department}</Label>
          <Controller
            control={control}
            name="departmentId"
            render={({ field }) => (
              <Select value={field.value ?? "none"} onValueChange={(v) => field.onChange(v === "none" ? null : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{strings.employees.none}</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{strings.employees.designation}</Label>
          <Controller
            control={control}
            name="designationId"
            render={({ field }) => (
              <Select value={field.value ?? "none"} onValueChange={(v) => field.onChange(v === "none" ? null : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{strings.employees.none}</SelectItem>
                  {designations.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{strings.employees.manager}</Label>
          <Controller
            control={control}
            name="managerId"
            render={({ field }) => (
              <Select value={field.value ?? "none"} onValueChange={(v) => field.onChange(v === "none" ? null : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{strings.employees.none}</SelectItem>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.firstName} {m.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          {strings.common.cancel}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? strings.employees.saving : strings.employees.save}
        </Button>
      </div>
    </form>
  );
}
