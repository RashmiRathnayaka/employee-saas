import { useState } from "react";
import type { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  CreateLeaveTypeRequestSchema,
  UpdateLeaveTypeRequestSchema,
  type LeaveTypeDto,
  type UpdateLeaveTypeRequest,
} from "@employee-saas/shared";
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
import { getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

// z.input, not z.infer - CreateLeaveTypeRequestSchema's `.default(...)`
// fields are optional on the way in, which is what react-hook-form's
// defaultValues/register actually need.
type CreateLeaveTypeFormValues = z.input<typeof CreateLeaveTypeRequestSchema>;

export function LeaveTypesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveTypeDto | null>(null);
  const [deleting, setDeleting] = useState<LeaveTypeDto | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => api.get<{ data: LeaveTypeDto[] }>("/leave-types"),
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ["leave-types"] });
  }

  const createMutation = useMutation({
    mutationFn: (values: CreateLeaveTypeFormValues) => api.post("/leave-types", values),
    onSuccess: async () => {
      await invalidate();
      setCreateOpen(false);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: UpdateLeaveTypeRequest }) =>
      api.patch(`/leave-types/${id}`, values),
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/leave-types/${id}`),
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
        <CardTitle>{strings.leaveTypes.title}</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {strings.leaveTypes.newLeaveType}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <ErrorState message={strings.common.somethingWentWrong} onRetry={() => refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title={strings.leaveTypes.noItems} />
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="py-2">{strings.leaveTypes.name}</th>
                <th className="py-2">{strings.leaveTypes.code}</th>
                <th className="py-2">{strings.leaveTypes.defaultAnnualDays}</th>
                <th className="py-2">{strings.leaveTypes.requiresProof}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((lt) => (
                <tr key={lt.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 font-medium text-slate-900">{lt.name}</td>
                  <td className="py-2.5 text-slate-600">{lt.code}</td>
                  <td className="py-2.5 text-slate-600">{lt.defaultAnnualDays}</td>
                  <td className="py-2.5 text-slate-600">{lt.requiresProof ? "Yes" : "No"}</td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      aria-label="Edit"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                      onClick={() => setEditing(lt)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                      onClick={() => setDeleting(lt)}
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

      <CreateLeaveTypeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(values) => createMutation.mutateAsync(values)}
      />

      {editing ? (
        <EditLeaveTypeDialog
          leaveType={editing}
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={(values) => updateMutation.mutateAsync({ id: editing.id, values })}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={strings.leaveTypes.deleteConfirm}
        onConfirm={() => deleting && deleteMutation.mutateAsync(deleting.id)}
      />
    </Card>
  );
}

function CreateLeaveTypeDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CreateLeaveTypeFormValues) => Promise<unknown>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateLeaveTypeFormValues>({
    resolver: zodResolver(CreateLeaveTypeRequestSchema),
    defaultValues: {
      name: "",
      code: "",
      defaultAnnualDays: 0,
      requiresProof: false,
      carryForwardAllowed: false,
      allowPastDates: false,
    },
  });

  async function submit(values: CreateLeaveTypeFormValues) {
    await onSubmit(values);
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{strings.leaveTypes.newLeaveType}</DialogTitle>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit(submit)}>
          <div className="space-y-1.5">
            <Label htmlFor="name">{strings.leaveTypes.name}</Label>
            <Input id="name" autoFocus {...register("name")} />
            {errors.name ? <p className="text-sm text-red-600">{errors.name.message}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code">{strings.leaveTypes.code}</Label>
            <Input id="code" {...register("code")} />
            {errors.code ? <p className="text-sm text-red-600">{errors.code.message}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="defaultAnnualDays">{strings.leaveTypes.defaultAnnualDays}</Label>
            <Input id="defaultAnnualDays" type="number" step="0.5" {...register("defaultAnnualDays", { valueAsNumber: true })} />
          </div>
          <BooleanRow id="requiresProof" label={strings.leaveTypes.requiresProof} register={register} />
          <BooleanRow id="carryForwardAllowed" label={strings.leaveTypes.carryForwardAllowed} register={register} />
          <BooleanRow id="allowPastDates" label={strings.leaveTypes.allowPastDates} register={register} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {strings.common.cancel}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {strings.leaveTypes.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditLeaveTypeDialog({
  leaveType,
  onOpenChange,
  onSubmit,
}: {
  leaveType: LeaveTypeDto;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: UpdateLeaveTypeRequest) => Promise<unknown>;
}) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<UpdateLeaveTypeRequest>({
    resolver: zodResolver(UpdateLeaveTypeRequestSchema),
    defaultValues: {
      name: leaveType.name,
      defaultAnnualDays: leaveType.defaultAnnualDays,
      requiresProof: leaveType.requiresProof,
      carryForwardAllowed: leaveType.carryForwardAllowed,
      allowPastDates: leaveType.allowPastDates,
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{strings.leaveTypes.edit}</DialogTitle>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit((values) => onSubmit(values))}>
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">{strings.leaveTypes.name}</Label>
            <Input id="edit-name" autoFocus {...register("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-defaultAnnualDays">{strings.leaveTypes.defaultAnnualDays}</Label>
            <Input
              id="edit-defaultAnnualDays"
              type="number"
              step="0.5"
              {...register("defaultAnnualDays", { valueAsNumber: true })}
            />
          </div>
          <BooleanRow id="edit-requiresProof" label={strings.leaveTypes.requiresProof} register={register} field="requiresProof" />
          <BooleanRow
            id="edit-carryForwardAllowed"
            label={strings.leaveTypes.carryForwardAllowed}
            register={register}
            field="carryForwardAllowed"
          />
          <BooleanRow id="edit-allowPastDates" label={strings.leaveTypes.allowPastDates} register={register} field="allowPastDates" />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {strings.common.cancel}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {strings.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BooleanRow({
  id,
  label,
  register,
  field,
}: {
  id: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
  field?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input type="checkbox" id={id} className="h-4 w-4" {...register(field ?? id)} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}
