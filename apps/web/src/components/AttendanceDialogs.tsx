import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CorrectAttendanceRequestSchema,
  CreateAttendanceRequestSchema,
  isModuleEnabled,
  type AttendanceRecordDto,
  type PaginatedResponse,
  type SiteDto,
} from "@employee-saas/shared";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { CompanyTimeFields } from "./CompanyTimeFields";
import { api, ApiClientError } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { useCompany } from "../lib/companyContext";
import { changedInstant, fromCompanyTimeInput, toCompanyTimeInput, type CompanyTimeInput } from "../lib/companyTimeInput";
import { getErrorMessage } from "../lib/errorMapping";
import { useCompanySettings, useManagerOptions } from "../lib/queries";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

type Errors = Partial<Record<"checkInAt" | "checkOutAt" | "reason" | "siteId" | "workDate" | "employeeId" | "form", string | undefined>>;

const NO_OFFICE = "none";

function serverErrors(error: unknown): Errors {
  const fields =
    error instanceof ApiClientError && error.code === "VALIDATION_ERROR"
      ? (error.details as { fieldErrors?: Record<string, string[] | undefined> } | undefined)?.fieldErrors
      : undefined;
  if (!fields) return { form: getErrorMessage(error) };
  return {
    checkInAt: fields.checkInAt?.[0],
    checkOutAt: fields.checkOutAt?.[0],
    reason: fields.reason?.[0],
    siteId: fields.siteId?.[0],
    workDate: fields.workDate?.[0],
    employeeId: fields.employeeId?.[0],
  };
}

function ErrorText({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-red-600">
      {message}
    </p>
  );
}

function ReasonField({ id, value, onChange, error }: { id: string; value: string; onChange: (value: string) => void; error: string | undefined }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{strings.corrections.reason}</Label>
      <textarea id={id} className="w-full rounded-md border border-slate-300 p-2 text-sm" rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
      <p className="text-xs text-slate-500">{strings.corrections.reasonHint}</p>
      <ErrorText message={error} />
    </div>
  );
}

/** The company's offices, for HR to pick from. Inactive ones stay on the list: a past day
 * may well have been at one. With `sites` off there's nothing to pick. */
function useOffices() {
  const settings = useCompanySettings();
  const enabled = isModuleEnabled(settings.data, "sites");
  const query = useQuery({
    queryKey: ["sites", "offices"],
    queryFn: () => api.get<PaginatedResponse<SiteDto>>("/sites?type=OFFICE&pageSize=100"),
    enabled,
    staleTime: 60_000,
  });
  return { enabled, offices: query.data?.data ?? [] };
}

function OfficeField({
  id,
  value,
  onChange,
  offices,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  offices: SiteDto[];
  error: string | undefined;
}) {
  return (
    <div className="space-y-1.5">
      <Label id={`${id}-label`}>{strings.attendance.office}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-labelledby={`${id}-label`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_OFFICE}>{strings.attendance.noOffice}</SelectItem>
          {offices.map((office) => (
            <SelectItem key={office.id} value={office.id}>
              {office.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ErrorText message={error} />
    </div>
  );
}

function invalidateAttendance(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ queryKey: ["attendance"] });
}

/** A row with no check-in starts with the work date filled in and the times empty. */
function startingInput(instant: string | null, workDate: string, timezone: string): CompanyTimeInput {
  return instant ? toCompanyTimeInput(instant, timezone) : { date: workDate, time: "" };
}

export function CorrectAttendanceDialog({ record, onClose }: { record: AttendanceRecordDto; onClose: () => void }) {
  const { timezone } = useCompany();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { enabled: sitesEnabled, offices } = useOffices();

  const originalIn = startingInput(record.checkInAt, record.workDate, timezone);
  const originalOut = startingInput(record.checkOutAt, record.workDate, timezone);
  const originalSite = record.checkInSiteId ?? NO_OFFICE;
  const [checkIn, setCheckIn] = useState(originalIn);
  const [checkOut, setCheckOut] = useState(originalOut);
  const [siteId, setSiteId] = useState(originalSite);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const mutation = useMutation({
    mutationFn: (body: unknown) => api.patch(`/attendance/${record.id}/correct`, body),
    onSuccess: async () => {
      await invalidateAttendance(queryClient);
      toast.success(strings.attendance.correctSaved);
      onClose();
    },
    onError: (error) => setErrors(serverErrors(error)),
  });

  function submit() {
    const incomplete: Errors = {};
    // A stored time can't be blanked: the API changes a time but doesn't remove one.
    if (record.checkInAt && (!checkIn.date || !checkIn.time)) incomplete.checkInAt = strings.corrections.incompleteTime;
    if (record.checkOutAt && (!checkOut.date || !checkOut.time)) incomplete.checkOutAt = strings.corrections.incompleteTime;
    if (!record.checkOutAt && checkOut.time && !checkOut.date) incomplete.checkOutAt = strings.corrections.incompleteTime;
    if (!record.checkInAt && checkIn.time && !checkIn.date) incomplete.checkInAt = strings.corrections.incompleteTime;
    if (incomplete.checkInAt || incomplete.checkOutAt) {
      setErrors(incomplete);
      return;
    }

    const checkInAt = changedInstant(checkIn, originalIn, timezone);
    const checkOutAt = changedInstant(checkOut, originalOut, timezone);
    const parsed = CorrectAttendanceRequestSchema.safeParse({
      ...(checkInAt ? { checkInAt } : {}),
      ...(checkOutAt ? { checkOutAt } : {}),
      ...(siteId !== originalSite ? { siteId: siteId === NO_OFFICE ? null : siteId } : {}),
      reason,
    });
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      setErrors({
        reason: flat.fieldErrors.reason?.[0],
        checkOutAt: flat.fieldErrors.checkOutAt?.[0],
        form: flat.formErrors.length > 0 ? strings.corrections.needsChange : undefined,
      });
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto" aria-describedby={undefined}>
        <DialogTitle>{strings.attendance.correctTitle}</DialogTitle>
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-500">
            {strings.corrections.companyTimeHint(timezone)} {strings.attendance.statusFollows}
          </p>
          <CompanyTimeFields id="correct-check-in" label={strings.attendance.checkIn} value={checkIn} onChange={setCheckIn} error={errors.checkInAt} />
          <CompanyTimeFields id="correct-check-out" label={strings.attendance.checkOut} value={checkOut} onChange={setCheckOut} error={errors.checkOutAt} />
          {sitesEnabled ? <OfficeField id="correct-office" value={siteId} onChange={setSiteId} offices={offices} error={errors.siteId} /> : null}
          <ReasonField id="correct-reason" value={reason} onChange={setReason} error={errors.reason} />
          <ErrorText message={errors.form} />
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

export function CreateAttendanceDialog({ defaultDate, onClose }: { defaultDate: string; onClose: () => void }) {
  const { user } = useAuth();
  const { timezone } = useCompany();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { enabled: sitesEnabled, offices } = useOffices();
  const employeesQuery = useManagerOptions();
  // Nobody creates their own: the API refuses it, so it isn't offered.
  const employees = (employeesQuery.data ?? []).filter((employee) => employee.id !== user?.employeeId);

  const [employeeId, setEmployeeId] = useState("");
  const [workDate, setWorkDate] = useState(defaultDate);
  const [checkIn, setCheckIn] = useState<CompanyTimeInput>({ date: defaultDate, time: "" });
  const [checkOut, setCheckOut] = useState<CompanyTimeInput>({ date: defaultDate, time: "" });
  const [siteId, setSiteId] = useState(NO_OFFICE);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [existingRecordId, setExistingRecordId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: unknown) => api.post("/attendance", body),
    onSuccess: async () => {
      await invalidateAttendance(queryClient);
      toast.success(strings.attendance.createSaved);
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.code === "ATTENDANCE_RECORD_EXISTS") {
        setExistingRecordId((error.details as { recordId?: string } | undefined)?.recordId ?? null);
        setErrors({ form: strings.attendance.existingRecord });
      } else {
        setErrors(serverErrors(error));
      }
    },
  });

  function changeWorkDate(date: string) {
    setWorkDate(date);
    setCheckIn((value) => ({ ...value, date }));
    setCheckOut((value) => ({ ...value, date }));
  }

  function submit() {
    setExistingRecordId(null);
    const checkInAt = fromCompanyTimeInput(checkIn, timezone);
    const checkOutAt = fromCompanyTimeInput(checkOut, timezone);
    const issues: Errors = {};
    if (!employeeId) issues.employeeId = strings.attendance.employeeRequired;
    if (!checkInAt) issues.checkInAt = strings.corrections.incompleteTime;
    if (checkOut.time && !checkOutAt) issues.checkOutAt = strings.corrections.incompleteTime;
    if (issues.employeeId || issues.checkInAt || issues.checkOutAt) {
      setErrors(issues);
      return;
    }

    const parsed = CreateAttendanceRequestSchema.safeParse({
      employeeId,
      workDate,
      checkInAt,
      ...(checkOutAt ? { checkOutAt } : {}),
      ...(siteId !== NO_OFFICE ? { siteId } : {}),
      reason,
    });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setErrors({ reason: flat.reason?.[0], checkOutAt: flat.checkOutAt?.[0], workDate: flat.workDate?.[0], employeeId: flat.employeeId?.[0] });
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto" aria-describedby={undefined}>
        <DialogTitle>{strings.attendance.createTitle}</DialogTitle>
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-500">
            {strings.corrections.companyTimeHint(timezone)} {strings.attendance.statusFollows}
          </p>
          <div className="space-y-1.5">
            <Label id="create-employee-label">{strings.attendance.employee}</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger aria-labelledby="create-employee-label">
                <SelectValue placeholder={strings.attendance.selectEmployee} />
              </SelectTrigger>
              <SelectContent>
                {employees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName} ({employee.employeeCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ErrorText message={errors.employeeId} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-work-date">{strings.attendance.workDate}</Label>
            <Input id="create-work-date" type="date" value={workDate} onChange={(e) => changeWorkDate(e.target.value)} />
            <ErrorText message={errors.workDate} />
          </div>
          <CompanyTimeFields id="create-check-in" label={strings.attendance.checkIn} value={checkIn} onChange={setCheckIn} error={errors.checkInAt} />
          <CompanyTimeFields id="create-check-out" label={strings.attendance.checkOut} value={checkOut} onChange={setCheckOut} error={errors.checkOutAt} />
          {sitesEnabled ? <OfficeField id="create-office" value={siteId} onChange={setSiteId} offices={offices} error={errors.siteId} /> : null}
          <ReasonField id="create-reason" value={reason} onChange={setReason} error={errors.reason} />
          <ErrorText message={errors.form} />
          {existingRecordId ? (
            <p className="text-sm">
              <Link className="text-[var(--color-primary)] hover:underline" to={`/attendance/${existingRecordId}`}>
                {strings.attendance.openExisting}
              </Link>
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
