import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AdjustLeaveBalanceRequestSchema, type AdjustLeaveBalanceRequest, type LeaveBalanceDto, type LeaveTypeDto } from "@employee-saas/shared";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { api } from "../lib/apiClient";
import { getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

export function AdjustBalanceDialog({
  open,
  onOpenChange,
  employeeId,
  balance,
  leaveType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  balance: LeaveBalanceDto;
  leaveType?: LeaveTypeDto;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AdjustLeaveBalanceRequest>({
    resolver: zodResolver(AdjustLeaveBalanceRequestSchema),
    defaultValues: {
      leaveTypeId: balance.leaveTypeId,
      year: balance.year,
      allocatedDays: balance.allocatedDays,
      usedDays: balance.usedDays,
      carriedOverDays: balance.carriedOverDays,
      note: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (values: AdjustLeaveBalanceRequest) => api.post(`/employees/${employeeId}/leave-balances/adjust`, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["employee", employeeId, "leave-balances"] });
      toast.success(strings.common.save);
      onOpenChange(false);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>
          {strings.employees.adjustBalanceTitle} - {leaveType?.name ?? balance.leaveTypeId}
        </DialogTitle>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit((values) => mutation.mutateAsync(values))}>
          <input type="hidden" {...register("leaveTypeId")} />
          <input type="hidden" {...register("year", { valueAsNumber: true })} />
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="allocatedDays">Allocated</Label>
              <Input id="allocatedDays" type="number" step="0.5" {...register("allocatedDays", { valueAsNumber: true })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="usedDays">Used</Label>
              <Input id="usedDays" type="number" step="0.5" {...register("usedDays", { valueAsNumber: true })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="carriedOverDays">Carried over</Label>
              <Input id="carriedOverDays" type="number" step="0.5" {...register("carriedOverDays", { valueAsNumber: true })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note">{strings.employees.adjustBalanceNote}</Label>
            <textarea id="note" className="w-full rounded-md border border-slate-300 p-2 text-sm" rows={2} {...register("note")} />
            {errors.note ? <p className="text-sm text-red-600">{errors.note.message}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {strings.common.cancel}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {strings.employees.adjustBalanceSave}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
