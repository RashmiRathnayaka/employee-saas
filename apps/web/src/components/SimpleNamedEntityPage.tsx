import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./ui/dialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { Skeleton } from "./ui/skeleton";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { api } from "../lib/apiClient";
import { getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

type NamedEntity = { id: string; name: string };

const NameSchema = z.object({ name: z.string().trim().min(1).max(100) });
type NameForm = z.infer<typeof NameSchema>;

export function SimpleNamedEntityPage({
  resourcePath,
  queryKey,
  title,
  newLabel,
  noItemsLabel,
}: {
  resourcePath: "/departments" | "/designations";
  queryKey: string;
  title: string;
  newLabel: string;
  noItemsLabel: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<NamedEntity | null>(null);
  const [deleting, setDeleting] = useState<NamedEntity | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [queryKey],
    queryFn: () => api.get<{ data: NamedEntity[] }>(resourcePath),
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: [queryKey] });
  }

  const createMutation = useMutation({
    mutationFn: (values: NameForm) => api.post<{ department?: NamedEntity; designation?: NamedEntity }>(resourcePath, values),
    onSuccess: async () => {
      await invalidate();
      setCreateOpen(false);
      toast.success(`${title} ${strings.common.save.toLowerCase()}d`);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const renameMutation = useMutation({
    mutationFn: (values: NameForm & { id: string }) => api.patch(`${resourcePath}/${values.id}`, { name: values.name }),
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
      toast.success(strings.common.save);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`${resourcePath}/${id}`),
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
        <CardTitle>{title}</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {newLabel}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <ErrorState message={strings.common.somethingWentWrong} onRetry={() => refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title={noItemsLabel} />
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 text-slate-900">{item.name}</td>
                  <td className="w-24 py-2 text-right">
                    <button
                      type="button"
                      aria-label="Edit"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                      onClick={() => setEditing(item)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                      onClick={() => setDeleting(item)}
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

      <NameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={newLabel}
        onSubmit={(values) => createMutation.mutateAsync(values)}
      />

      {editing ? (
        <NameDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          title={strings.departments.rename}
          defaultValue={editing.name}
          onSubmit={(values) => renameMutation.mutateAsync({ ...values, id: editing.id })}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={strings.departments.deleteConfirm}
        onConfirm={() => deleting && deleteMutation.mutateAsync(deleting.id)}
      />
    </Card>
  );
}

function NameDialog({
  open,
  onOpenChange,
  title,
  defaultValue,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  defaultValue?: string;
  onSubmit: (values: NameForm) => Promise<unknown>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NameForm>({ resolver: zodResolver(NameSchema), defaultValues: { name: defaultValue ?? "" } });

  async function submit(values: NameForm) {
    try {
      await onSubmit(values);
      reset();
    } catch {
      // error toast already shown by the caller's mutation
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <form className="mt-4 space-y-1.5" onSubmit={handleSubmit(submit)}>
          <Label htmlFor="name">{strings.departments.name}</Label>
          <Input id="name" autoFocus {...register("name")} />
          {errors.name ? <p className="text-sm text-red-600">{errors.name.message}</p> : null}
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
