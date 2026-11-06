import { Controller, useForm, type UseFormSetError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isModuleEnabled,
  UpdateCompanyProfileRequestSchema,
  UpdateCompanySettingsRequestSchema,
  type CompanyDto,
  type CompanyModule,
  type CompanySettingsDto,
  type UpdateCompanyProfileRequest,
  type UpdateCompanySettingsRequest,
} from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/apiClient";
import { DEFAULT_PRIMARY_COLOR } from "../lib/companyContext";
import { applyApiErrorToForm, getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

const WEEKDAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

export function CompanySettingsPage() {
  const companyQuery = useQuery({
    queryKey: ["company"],
    queryFn: () => api.get<{ company: CompanyDto }>("/company"),
  });
  const settingsQuery = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => api.get<{ settings: CompanySettingsDto }>("/company/settings"),
  });

  if (companyQuery.isLoading || settingsQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (!companyQuery.data || !settingsQuery.data) {
    return null;
  }

  return (
    <div className="space-y-6">
      <ProfileCard company={companyQuery.data.company} />
      <SettingsCard settings={settingsQuery.data.settings} />
      <ModulesCard settings={settingsQuery.data.settings} />
      <AttendanceSettingsCard settings={settingsQuery.data.settings} />
    </div>
  );
}

function ProfileCard({ company }: { company: CompanyDto }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  // The colour the app is really using. Lower case, because a colour input
  // lower-cases its value and this is compared with it.
  const currentColor = (company.primaryColor ?? DEFAULT_PRIMARY_COLOR).toLowerCase();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<UpdateCompanyProfileRequest>({
    resolver: zodResolver(UpdateCompanyProfileRequestSchema),
    defaultValues: { name: company.name, primaryColor: currentColor },
  });

  /** Leaves the colour out unless the user changed it, so saving the name can't
   * turn the default into a stored brand colour. */
  function withoutUnchangedColor({ primaryColor, ...rest }: UpdateCompanyProfileRequest): UpdateCompanyProfileRequest {
    return primaryColor?.toLowerCase() === currentColor ? rest : { ...rest, primaryColor };
  }

  const mutation = useMutation({
    mutationFn: (values: UpdateCompanyProfileRequest) => api.patch("/company", values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["company"] });
      toast.success(strings.settings.saved);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{strings.settings.profile}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-wrap items-end gap-4" onSubmit={handleSubmit((values) => mutation.mutateAsync(withoutUnchangedColor(values)))}>
          <div className="space-y-1.5">
            <Label htmlFor="name">{strings.settings.name}</Label>
            <Input id="name" className="w-64" {...register("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="primaryColor">{strings.settings.primaryColor}</Label>
            {/* defaultValue is needed as well as the form's default. A colour input
                with none reports #000000, and react-hook-form takes "value differs
                from defaultValue" to mean the user already edited it, so it would
                keep the black and ignore the form's default. */}
            <input
              id="primaryColor"
              type="color"
              defaultValue={currentColor}
              className="h-10 w-16 rounded border border-slate-300"
              {...register("primaryColor")}
            />
          </div>
          <Button type="submit" disabled={isSubmitting}>
            {strings.settings.save}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** The save behaviour shared by the Modules and Attendance cards. A server
 * validation error goes next to its field; anything else becomes a toast. */
function useSaveSettings(setError: UseFormSetError<UpdateCompanySettingsRequest>) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: UpdateCompanySettingsRequest) => api.patch("/company/settings", values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      toast.success(strings.settings.saved);
    },
    onError: (error) => {
      if (!applyApiErrorToForm(error, setError)) toast.error(getErrorMessage(error));
    },
  });
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-red-600">
      {message}
    </p>
  );
}

const MODULE_OPTIONS: { key: CompanyModule; label: string; hint: string }[] = [
  { key: "attendance", label: strings.settings.moduleAttendance, hint: strings.settings.moduleAttendanceHint },
  { key: "sites", label: strings.settings.moduleSites, hint: strings.settings.moduleSitesHint },
  { key: "tasks", label: strings.settings.moduleTasks, hint: strings.settings.moduleTasksHint },
];

function ModulesCard({ settings }: { settings: CompanySettingsDto }) {
  const {
    control,
    handleSubmit,
    setError,
    formState: { isSubmitting },
  } = useForm<UpdateCompanySettingsRequest>({
    resolver: zodResolver(UpdateCompanySettingsRequestSchema),
    defaultValues: {
      enabledModules: {
        attendance: isModuleEnabled(settings, "attendance"),
        sites: isModuleEnabled(settings, "sites"),
        tasks: isModuleEnabled(settings, "tasks"),
      },
    },
  });
  const mutation = useSaveSettings(setError);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{strings.settings.modules}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit((values) => mutation.mutateAsync(values).catch(() => undefined))}>
          <p className="text-xs text-slate-500">{strings.settings.modulesHint}</p>
          {MODULE_OPTIONS.map((option) => (
            <div key={option.key} className="flex items-start gap-3">
              <Controller
                control={control}
                name={`enabledModules.${option.key}`}
                render={({ field }) => (
                  <Checkbox
                    id={`module-${option.key}`}
                    className="mt-0.5"
                    checked={field.value === true}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                )}
              />
              <div>
                <Label htmlFor={`module-${option.key}`}>{option.label}</Label>
                <p className="text-xs text-slate-500">{option.hint}</p>
              </div>
            </div>
          ))}
          <Button type="submit" disabled={isSubmitting}>
            {strings.settings.save}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AttendanceSettingsCard({ settings }: { settings: CompanySettingsDto }) {
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UpdateCompanySettingsRequest>({
    resolver: zodResolver(UpdateCompanySettingsRequestSchema),
    defaultValues: {
      workStartTime: settings.workStartTime,
      workEndTime: settings.workEndTime,
      halfDayEndTime: settings.halfDayEndTime,
      lateGraceMinutes: settings.lateGraceMinutes,
      autoCheckoutAfterMinutes: settings.autoCheckoutAfterMinutes,
      checkinReminderEnabled: settings.checkinReminderEnabled,
      checkinReminderOffsetMinutes: settings.checkinReminderOffsetMinutes,
      proofRemindersEnabled: settings.proofRemindersEnabled,
      dailyReminderTime: settings.dailyReminderTime,
      gpsMaxAccuracyMeters: settings.gpsMaxAccuracyMeters,
      gpsRetentionDays: settings.gpsRetentionDays,
      gpsRadiusMeters: settings.gpsRadiusMeters,
      gpsCheckinEnabledDefault: settings.gpsCheckinEnabledDefault,
    },
  });
  const mutation = useSaveSettings(setError);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{strings.settings.attendanceSettings}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="space-y-6"
          onSubmit={handleSubmit((values) => mutation.mutateAsync(values).catch(() => undefined))}
        >
          <p className="text-xs text-slate-500">{strings.settings.attendanceSettingsHint}</p>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">{strings.settings.workHours}</h3>
              <p className="mt-1 text-xs text-slate-500">{strings.settings.workHoursHint}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="workStartTime">{strings.settings.workStartTime}</Label>
                <Input id="workStartTime" type="time" {...register("workStartTime")} />
                <FieldError message={errors.workStartTime?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="workEndTime">{strings.settings.workEndTime}</Label>
                <Input id="workEndTime" type="time" {...register("workEndTime")} />
                <FieldError message={errors.workEndTime?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="halfDayEndTime">{strings.settings.halfDayEndTime}</Label>
                <Input id="halfDayEndTime" type="time" {...register("halfDayEndTime")} />
                <FieldError message={errors.halfDayEndTime?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lateGraceMinutes">{strings.settings.lateGraceMinutes}</Label>
                <Input id="lateGraceMinutes" type="number" {...register("lateGraceMinutes", { valueAsNumber: true })} />
                <FieldError message={errors.lateGraceMinutes?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="autoCheckoutAfterMinutes">{strings.settings.autoCheckoutAfterMinutes}</Label>
                <Input
                  id="autoCheckoutAfterMinutes"
                  type="number"
                  {...register("autoCheckoutAfterMinutes", { valueAsNumber: true })}
                />
                <FieldError message={errors.autoCheckoutAfterMinutes?.message} />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">{strings.settings.reminders}</h3>
            <div className="flex items-center gap-3">
              <Controller
                control={control}
                name="checkinReminderEnabled"
                render={({ field }) => (
                  <Checkbox
                    id="checkinReminderEnabled"
                    checked={field.value === true}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                )}
              />
              <Label htmlFor="checkinReminderEnabled">{strings.settings.checkinReminderEnabled}</Label>
            </div>
            <div className="flex items-center gap-3">
              <Controller
                control={control}
                name="proofRemindersEnabled"
                render={({ field }) => (
                  <Checkbox
                    id="proofRemindersEnabled"
                    checked={field.value === true}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                )}
              />
              <Label htmlFor="proofRemindersEnabled">{strings.settings.proofRemindersEnabled}</Label>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="checkinReminderOffsetMinutes">{strings.settings.checkinReminderOffsetMinutes}</Label>
                <Input
                  id="checkinReminderOffsetMinutes"
                  type="number"
                  {...register("checkinReminderOffsetMinutes", { valueAsNumber: true })}
                />
                <FieldError message={errors.checkinReminderOffsetMinutes?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dailyReminderTime">{strings.settings.dailyReminderTime}</Label>
                <Input id="dailyReminderTime" type="time" {...register("dailyReminderTime")} />
                <FieldError message={errors.dailyReminderTime?.message} />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">{strings.settings.gpsSection}</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="gpsMaxAccuracyMeters">{strings.settings.gpsMaxAccuracyMeters}</Label>
                <Input id="gpsMaxAccuracyMeters" type="number" {...register("gpsMaxAccuracyMeters", { valueAsNumber: true })} />
                <FieldError message={errors.gpsMaxAccuracyMeters?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gpsRetentionDays">{strings.settings.gpsRetentionDays}</Label>
                <Input id="gpsRetentionDays" type="number" {...register("gpsRetentionDays", { valueAsNumber: true })} />
                <FieldError message={errors.gpsRetentionDays?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gpsRadiusMeters">{strings.settings.gpsRadiusMeters}</Label>
                <Input id="gpsRadiusMeters" type="number" {...register("gpsRadiusMeters", { valueAsNumber: true })} />
                <FieldError message={errors.gpsRadiusMeters?.message} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Controller
                control={control}
                name="gpsCheckinEnabledDefault"
                render={({ field }) => (
                  <Checkbox
                    id="gpsCheckinEnabledDefault"
                    checked={field.value === true}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                )}
              />
              <Label htmlFor="gpsCheckinEnabledDefault">{strings.settings.gpsCheckinEnabledDefault}</Label>
            </div>
            <p className="text-xs text-slate-500">{strings.settings.gpsDefaultsHint}</p>
          </section>

          <Button type="submit" disabled={isSubmitting}>
            {strings.settings.save}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SettingsCard({ settings }: { settings: CompanySettingsDto }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<UpdateCompanySettingsRequest>({
    resolver: zodResolver(UpdateCompanySettingsRequestSchema),
    defaultValues: {
      leaveApprovalWorkflow: settings.leaveApprovalWorkflow,
      sickLeaveProofDeadlineDays: settings.sickLeaveProofDeadlineDays,
      employeeIdPrefix: settings.employeeIdPrefix,
      workingDays: settings.workingDays,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: UpdateCompanySettingsRequest) => api.patch("/company/settings", values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      toast.success(strings.settings.saved);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{strings.settings.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit((values) => mutation.mutateAsync(values))}>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="leaveApprovalWorkflow">{strings.settings.leaveWorkflow}</Label>
              <select
                id="leaveApprovalWorkflow"
                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                {...register("leaveApprovalWorkflow")}
              >
                <option value="MANAGER_ONLY">{strings.settings.workflowManagerOnly}</option>
                <option value="MANAGER_THEN_HR">{strings.settings.workflowManagerThenHr}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sickLeaveProofDeadlineDays">{strings.settings.sickLeaveProofDeadlineDays}</Label>
              <Input
                id="sickLeaveProofDeadlineDays"
                type="number"
                {...register("sickLeaveProofDeadlineDays", { valueAsNumber: true })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="employeeIdPrefix">{strings.settings.employeeIdPrefix}</Label>
              <Input id="employeeIdPrefix" {...register("employeeIdPrefix")} />
            </div>
          </div>

          <div>
            <Label>{strings.settings.workingDays}</Label>
            <p className="mt-1 text-xs text-slate-500">{strings.settings.workingDaysHint}</p>
            <div className="mt-2 grid grid-cols-7 gap-2">
              {WEEKDAYS.map((day) => (
                <div key={day.key} className="space-y-1">
                  <p className="text-xs font-medium text-slate-600">{day.label.slice(0, 3)}</p>
                  <select
                    className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-1 text-xs"
                    {...register(`workingDays.${day.key}` as "workingDays.mon")}
                  >
                    <option value="FULL">{strings.settings.full}</option>
                    <option value="HALF">{strings.settings.half}</option>
                    <option value="OFF">{strings.settings.off}</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={isSubmitting}>
            {strings.settings.save}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
