import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { CreateHolidayRequestSchema, type CreateHolidayRequest } from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../components/ui/dialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { api } from "../lib/apiClient";
import { useCompany } from "../lib/companyContext";
import { formatDate } from "../lib/formatDate";
import { getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

type Holiday = { id: string; date: string; name: string };

export function HolidaysPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { timezone } = useCompany();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<Holiday | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["holidays"],
    queryFn: () => api.get<{ data: Holiday[] }>("/company/holidays"),
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ["holidays"] });
  }

  const createMutation = useMutation({
    mutationFn: (values: CreateHolidayRequest) => api.post("/company/holidays", values),
    onSuccess: async () => {
      await invalidate();
      setCreateOpen(false);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/company/holidays/${id}`),
    onSuccess: async () => {
      await invalidate();
      setDeleting(null);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
      setDeleting(null);
    },
  });

  const items = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{strings.holidays.title}</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {strings.holidays.newHoliday}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <ErrorState message={strings.common.somethingWentWrong} onRetry={() => refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title={strings.holidays.noItems} />
        ) : (
          <table className="w-full text-left text-sm">
            <tbody>
              {items.map((holiday) => (
                <tr key={holiday.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 text-slate-500">{formatDate(holiday.date, timezone)}</td>
                  <td className="py-2 text-slate-900">{holiday.name}</td>
                  <td className="w-12 py-2 text-right">
                    <button
                      type="button"
                      aria-label="Delete"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                      onClick={() => setDeleting(holiday)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>

      <CreateHolidayDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={(v) => createMutation.mutateAsync(v)} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={strings.holidays.deleteConfirm}
        onConfirm={() => deleting && deleteMutation.mutateAsync(deleting.id)}
      />
    </Card>
  );
}

function CreateHolidayDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CreateHolidayRequest) => Promise<unknown>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateHolidayRequest>({
    resolver: zodResolver(CreateHolidayRequestSchema),
    defaultValues: { date: "", name: "" },
  });

  async function submit(values: CreateHolidayRequest) {
    await onSubmit(values);
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{strings.holidays.newHoliday}</DialogTitle>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="space-y-1.5">
            <Label htmlFor="date">{strings.holidays.date}</Label>
            <Input id="date" type="date" autoFocus {...register("date")} />
            {errors.date ? <p className="text-sm text-red-600">{errors.date.message}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="holidayName">{strings.holidays.name}</Label>
            <Input id="holidayName" {...register("name")} />
            {errors.name ? <p className="text-sm text-red-600">{errors.name.message}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {strings.common.cancel}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {strings.holidays.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
