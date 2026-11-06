import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isModuleEnabled,
  SetEmployeeScheduleRequestSchema,
  type EmployeeScheduleResponse,
  type WeekSchedule,
} from "@employee-saas/shared";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import { ConfirmDialog } from "./ConfirmDialog";
import { ErrorState } from "./ErrorState";
import { api, ApiClientError } from "../lib/apiClient";
import { getErrorMessage } from "../lib/errorMapping";
import { useCompanySettings } from "../lib/queries";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const WEIGHT_LABELS = { FULL: strings.schedule.full, HALF: strings.schedule.half, OFF: strings.schedule.off };

/** "22:00 - 06:00 (next day)". An end at or before the start is the next day. */
function hoursText(start: string, end: string): string {
  return end <= start ? `${start} - ${end} (${strings.schedule.nextDay})` : `${start} - ${end}`;
}

type Errors = { startTime?: string | undefined; endTime?: string | undefined; lateGraceMinutes?: string | undefined; form?: string | undefined };

function ScheduleForm({
  employeeId,
  current,
  onClose,
}: {
  employeeId: string;
  current: EmployeeScheduleResponse;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [startTime, setStartTime] = useState(current.schedule.startTime);
  const [endTime, setEndTime] = useState(current.schedule.endTime);
  const [grace, setGrace] = useState(current.override?.lateGraceMinutes?.toString() ?? "");
  const [followCompanyWeek, setFollowCompanyWeek] = useState(!current.override?.workingDays);
  const [week, setWeek] = useState<WeekSchedule>(current.schedule.workingDays);
  const [errors, setErrors] = useState<Errors>({});

  const mutation = useMutation({
    mutationFn: (body: unknown) => api.put(`/employees/${employeeId}/schedule`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["employee", employeeId, "schedule"] });
      toast.success(strings.schedule.saved);
      onClose();
    },
    onError: (error) => {
      const fields =
        error instanceof ApiClientError && error.code === "VALIDATION_ERROR"
          ? (error.details as { fieldErrors?: Record<string, string[] | undefined> } | undefined)?.fieldErrors
          : undefined;
      setErrors(
        fields
          ? { startTime: fields.startTime?.[0], endTime: fields.endTime?.[0], lateGraceMinutes: fields.lateGraceMinutes?.[0] }
          : { form: getErrorMessage(error) },
      );
    },
  });

  function submit() {
    const parsed = SetEmployeeScheduleRequestSchema.safeParse({
      startTime,
      endTime,
      lateGraceMinutes: grace.trim() === "" ? null : Number(grace),
      workingDays: followCompanyWeek ? null : week,
    });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setErrors({ startTime: flat.startTime?.[0], endTime: flat.endTime?.[0], lateGraceMinutes: flat.lateGraceMinutes?.[0] });
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto" aria-describedby={undefined}>
        <DialogTitle>{strings.schedule.formTitle}</DialogTitle>
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-500">{strings.schedule.formHint}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="schedule-start">{strings.schedule.startTime}</Label>
              <Input id="schedule-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              {errors.startTime ? (
                <p role="alert" className="text-sm text-red-600">
                  {errors.startTime}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-end">{strings.schedule.endTime}</Label>
              <Input id="schedule-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              {errors.endTime ? (
                <p role="alert" className="text-sm text-red-600">
                  {errors.endTime}
                </p>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-slate-500">{strings.schedule.endTimeHint}</p>

          <div className="space-y-1.5">
            <Label htmlFor="schedule-grace">{strings.schedule.graceOptional}</Label>
            <Input id="schedule-grace" type="number" min={0} max={240} className="w-32" value={grace} onChange={(e) => setGrace(e.target.value)} />
            <p className="text-xs text-slate-500">{strings.schedule.graceHint}</p>
            {errors.lateGraceMinutes ? (
              <p role="alert" className="text-sm text-red-600">
                {errors.lateGraceMinutes}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="schedule-follow-week"
              checked={followCompanyWeek}
              onCheckedChange={(checked) => setFollowCompanyWeek(checked === true)}
            />
            <Label htmlFor="schedule-follow-week">{strings.schedule.followCompanyWeek}</Label>
          </div>

          {followCompanyWeek ? null : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {DAYS.map((day) => (
                <div key={day} className="space-y-1">
                  <Label id={`schedule-${day}`} className="text-xs text-slate-500">
                    {strings.schedule.days[day]}
                  </Label>
                  <Select value={week[day]} onValueChange={(value) => setWeek({ ...week, [day]: value as WeekSchedule[typeof day] })}>
                    <SelectTrigger aria-labelledby={`schedule-${day}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["FULL", "HALF", "OFF"] as const).map((weight) => (
                        <SelectItem key={weight} value={weight}>
                          {WEIGHT_LABELS[weight]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}

          {errors.form ? (
            <p role="alert" className="text-sm text-red-600">
              {errors.form}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {strings.common.cancel}
            </Button>
            <Button type="button" disabled={mutation.isPending} onClick={submit}>
              {strings.common.save}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The employee page's Schedule section. HR and Company Admin can change it, and a
 * manager only reads it. The API enforces both. */
export function EmployeeScheduleCard({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useCompanySettings();
  const enabled = isModuleEnabled(settings.data, "attendance");
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  const query = useQuery({
    queryKey: ["employee", employeeId, "schedule"],
    queryFn: () => api.get<EmployeeScheduleResponse>(`/employees/${employeeId}/schedule`),
    enabled,
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/employees/${employeeId}/schedule`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["employee", employeeId, "schedule"] });
      toast.success(strings.schedule.removed);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  if (!enabled) return null;

  const data = query.data;
  const isOverride = data?.schedule.source === "OVERRIDE";

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{strings.schedule.title}</CardTitle>
        {canEdit && data ? (
          <div className="flex items-center gap-2">
            {isOverride ? (
              <Button variant="secondary" size="sm" onClick={() => setRemoving(true)}>
                {strings.schedule.removeOverride}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setEditing(true)}>
              {isOverride ? strings.schedule.editOverride : strings.schedule.setOverride}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : query.isError || !data ? (
          <ErrorState message={strings.common.somethingWentWrong} onRetry={() => query.refetch()} />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase text-slate-400">{strings.schedule.source}</dt>
                <dd className="mt-0.5 text-slate-900">{isOverride ? strings.schedule.sourceOverride : strings.schedule.sourceCompany}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-400">{strings.schedule.hours}</dt>
                <dd className="mt-0.5 text-slate-900">{hoursText(data.schedule.startTime, data.schedule.endTime)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-400">{strings.schedule.grace}</dt>
                <dd className="mt-0.5 text-slate-900">{strings.schedule.graceValue(data.schedule.lateGraceMinutes)}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <p className="text-xs uppercase text-slate-400">{strings.schedule.workingDays}</p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
                {DAYS.map((day) => (
                  <li key={day}>
                    {strings.schedule.days[day]}: {WEIGHT_LABELS[data.schedule.workingDays[day]]}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>

      {editing && data ? <ScheduleForm employeeId={employeeId} current={data} onClose={() => setEditing(false)} /> : null}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={strings.schedule.removeConfirm}
        description={strings.schedule.removeConfirmHint}
        destructive={false}
        onConfirm={() => remove.mutateAsync()}
      />
    </Card>
  );
}
