import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  UpdateCompanyProfileRequestSchema,
  UpdateCompanySettingsRequestSchema,
  type CompanyDto,
  type UpdateCompanyProfileRequest,
  type UpdateCompanySettingsRequest,
} from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/apiClient";
import { getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

type CompanySettings = {
  leaveApprovalWorkflow: "MANAGER_ONLY" | "MANAGER_THEN_HR";
  sickLeaveProofDeadlineDays: number;
  employeeIdPrefix: string;
  workingDays: Record<string, "FULL" | "HALF" | "OFF">;
};

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
    queryFn: () => api.get<{ settings: CompanySettings }>("/company/settings"),
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
    </div>
  );
}

function ProfileCard({ company }: { company: CompanyDto }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<UpdateCompanyProfileRequest>({
    resolver: zodResolver(UpdateCompanyProfileRequestSchema),
    defaultValues: { name: company.name, primaryColor: company.primaryColor },
  });

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
        <form className="flex flex-wrap items-end gap-4" onSubmit={handleSubmit((values) => mutation.mutateAsync(values))}>
          <div className="space-y-1.5">
            <Label htmlFor="name">{strings.settings.name}</Label>
            <Input id="name" className="w-64" {...register("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="primaryColor">{strings.settings.primaryColor}</Label>
            <input id="primaryColor" type="color" className="h-10 w-16 rounded border border-slate-300" {...register("primaryColor")} />
          </div>
          <Button type="submit" disabled={isSubmitting}>
            {strings.settings.save}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SettingsCard({ settings }: { settings: CompanySettings }) {
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
