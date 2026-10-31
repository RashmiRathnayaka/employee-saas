import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { CreateCompanyRequestSchema, type CompanyDto, type CreateCompanyRequest, type PaginatedResponse } from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../components/ui/dialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TempPasswordDialog } from "../components/TempPasswordDialog";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { StatusBadge } from "../components/StatusBadge";
import { Pagination } from "../components/Pagination";
import { api } from "../lib/apiClient";
import { applyApiErrorToForm, getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

const PAGE_SIZE = 20;

export function CompaniesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<CompanyDto | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["companies", page],
    queryFn: () => api.get<PaginatedResponse<CompanyDto>>(`/companies?page=${page}&pageSize=${PAGE_SIZE}`),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "SUSPENDED" }) =>
      api.patch(`/companies/${id}/status`, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] });
      setStatusTarget(null);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
      setStatusTarget(null);
    },
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{strings.companies.title}</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {strings.companies.newCompany}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <ErrorState message={strings.common.somethingWentWrong} onRetry={() => refetch()} />
        ) : !data || data.data.length === 0 ? (
          <EmptyState title="No companies yet" />
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2">{strings.companies.name}</th>
                  <th className="py-2">{strings.companies.code}</th>
                  <th className="py-2">{strings.table.status}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {data.data.map((company) => (
                  <tr key={company.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 font-medium text-slate-900">{company.name}</td>
                    <td className="py-2.5 text-slate-600">{company.code}</td>
                    <td className="py-2.5">
                      <StatusBadge status={company.status} />
                    </td>
                    <td className="py-2.5 text-right">
                      <Button variant="secondary" size="sm" onClick={() => setStatusTarget(company)}>
                        {company.status === "ACTIVE" ? strings.companies.suspend : strings.companies.reactivate}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
          </>
        )}
      </CardContent>

      <CreateCompanyDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setTemporaryPassword} />

      <ConfirmDialog
        open={!!statusTarget}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={statusTarget?.status === "ACTIVE" ? strings.companies.suspend : strings.companies.reactivate}
        description={statusTarget?.status === "ACTIVE" ? strings.companies.suspendConfirm : strings.companies.reactivateConfirm}
        destructive={statusTarget?.status === "ACTIVE"}
        onConfirm={() =>
          statusTarget &&
          statusMutation.mutateAsync({ id: statusTarget.id, status: statusTarget.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })
        }
      />

      <TempPasswordDialog
        open={!!temporaryPassword}
        onOpenChange={() => setTemporaryPassword(null)}
        password={temporaryPassword}
        title={strings.companies.createdTitle}
      />
    </Card>
  );
}

function CreateCompanyDialog({
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
  } = useForm<CreateCompanyRequest>({
    resolver: zodResolver(CreateCompanyRequestSchema),
    defaultValues: { name: "", code: "", adminEmail: "" },
  });

  async function onSubmit(values: CreateCompanyRequest) {
    try {
      const res = await api.post<{ temporaryPassword: string }>("/companies", values);
      await queryClient.invalidateQueries({ queryKey: ["companies"] });
      reset();
      onOpenChange(false);
      onCreated(res.temporaryPassword);
    } catch (error) {
      if (!applyApiErrorToForm(error, setError)) {
        toast.error(getErrorMessage(error));
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{strings.companies.newCompany}</DialogTitle>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-1.5">
            <Label htmlFor="name">{strings.companies.name}</Label>
            <Input id="name" autoFocus {...register("name")} />
            {errors.name ? <p className="text-sm text-red-600">{errors.name.message}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code">{strings.companies.code}</Label>
            <Input id="code" {...register("code")} />
            {errors.code ? <p className="text-sm text-red-600">{errors.code.message}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adminEmail">{strings.companies.adminEmail}</Label>
            <Input id="adminEmail" type="email" {...register("adminEmail")} />
            {errors.adminEmail ? <p className="text-sm text-red-600">{errors.adminEmail.message}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {strings.common.cancel}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {strings.companies.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
