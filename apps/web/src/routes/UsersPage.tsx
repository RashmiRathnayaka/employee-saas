import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  CreateUserRequestSchema,
  type CreateUserRequest,
  type CreateUserResponse,
  type PaginatedResponse,
  type Role,
  type UserDto,
} from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../components/ui/dialog";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { StatusBadge } from "../components/StatusBadge";
import { Pagination } from "../components/Pagination";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TempPasswordDialog } from "../components/TempPasswordDialog";
import { api, ApiClientError } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

const PAGE_SIZE = 20;
const ASSIGNABLE_ROLES: Role[] = ["COMPANY_ADMIN", "HR", "MANAGER"];

export function UsersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "COMPANY_ADMIN";
  const toast = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<UserDto | null>(null);
  const [resetTarget, setResetTarget] = useState<UserDto | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["users", page],
    queryFn: () => api.get<PaginatedResponse<UserDto>>(`/users?page=${page}&pageSize=${PAGE_SIZE}`),
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ["users"] });
  }

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => api.patch(`/users/${id}`, { role }),
    onSuccess: invalidate,
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DEACTIVATED" }) =>
      api.patch(`/users/${id}/status`, { status }),
    onSuccess: async () => {
      await invalidate();
      setStatusTarget(null);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
      setStatusTarget(null);
    },
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) => api.post<{ temporaryPassword: string }>(`/users/${id}/reset-password`),
    onSuccess: (res) => {
      setTemporaryPassword(res.temporaryPassword);
      setResetTarget(null);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
      setResetTarget(null);
    },
  });

  const canResetPassword = (target: UserDto) => isAdmin || target.role !== "COMPANY_ADMIN";

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{strings.users.title}</CardTitle>
        {isAdmin ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {strings.users.newUser}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState message={strings.common.somethingWentWrong} onRetry={() => refetch()} />
        ) : !data || data.data.length === 0 ? (
          <EmptyState title={strings.users.noUsers} />
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2">{strings.users.email}</th>
                  <th className="py-2">{strings.users.role}</th>
                  <th className="py-2">{strings.users.status}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {data.data.map((target) => (
                  <tr key={target.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 text-slate-900">{target.email ?? "-"}</td>
                    <td className="py-2.5">
                      {isAdmin ? (
                        <Select
                          value={target.role}
                          onValueChange={(role) => roleMutation.mutate({ id: target.id, role: role as Role })}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ASSIGNABLE_ROLES.map((role) => (
                              <SelectItem key={role} value={role}>
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        target.role
                      )}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={target.status} />
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex justify-end gap-2">
                        {canResetPassword(target) ? (
                          <Button variant="secondary" size="sm" onClick={() => setResetTarget(target)}>
                            {strings.users.resetPassword}
                          </Button>
                        ) : null}
                        {isAdmin ? (
                          <Button variant="secondary" size="sm" onClick={() => setStatusTarget(target)}>
                            {target.status === "ACTIVE" ? strings.users.deactivate : strings.users.activate}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
          </>
        )}
      </CardContent>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setTemporaryPassword} />

      <ConfirmDialog
        open={!!statusTarget}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={statusTarget?.status === "ACTIVE" ? strings.users.deactivate : strings.users.activate}
        description={statusTarget?.status === "ACTIVE" ? strings.users.deactivateConfirm : undefined}
        destructive={statusTarget?.status === "ACTIVE"}
        onConfirm={() =>
          statusTarget &&
          statusMutation.mutateAsync({ id: statusTarget.id, status: statusTarget.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE" })
        }
      />

      <ConfirmDialog
        open={!!resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title={strings.users.resetPassword}
        description={strings.users.resetPasswordConfirm}
        destructive={false}
        onConfirm={() => resetTarget && resetMutation.mutateAsync(resetTarget.id)}
      />

      <TempPasswordDialog open={!!temporaryPassword} onOpenChange={() => setTemporaryPassword(null)} password={temporaryPassword} />
    </Card>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (password: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserRequest>({
    resolver: zodResolver(CreateUserRequestSchema),
    defaultValues: { email: "", role: "HR" },
  });

  async function onSubmit(values: CreateUserRequest) {
    try {
      const res = await api.post<CreateUserResponse>("/users", values);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      reset();
      onOpenChange(false);
      onCreated(res.temporaryPassword);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "EMAIL_TAKEN") {
        setError("email", { message: getErrorMessage(error) });
      } else {
        toast.error(getErrorMessage(error));
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{strings.users.newUser}</DialogTitle>
        <form className="mt-4 space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-1.5">
            <Label htmlFor="email">{strings.users.email}</Label>
            <Input id="email" type="email" autoFocus {...register("email")} />
            {errors.email ? <p className="text-sm text-red-600">{errors.email.message}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">{strings.users.role}</Label>
            <select
              id="role"
              className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              {...register("role")}
            >
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {strings.common.cancel}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {strings.users.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
