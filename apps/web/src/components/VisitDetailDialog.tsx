import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CorrectSiteVisitRequestSchema,
  formatDate,
  formatDuration,
  formatTime,
  type SiteVisitDetailDto,
  type SiteVisitWithCoordinatesDto,
} from "@employee-saas/shared";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { Skeleton } from "./ui/skeleton";
import { CompanyTimeFields } from "./CompanyTimeFields";
import { CorrectionHistory } from "./CorrectionHistory";
import { ErrorState } from "./ErrorState";
import { PositionDetails } from "./PositionDetails";
import { StatusBadge } from "./StatusBadge";
import { api, ApiClientError } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { useCompany } from "../lib/companyContext";
import { changedInstant, toCompanyTimeInput } from "../lib/companyTimeInput";
import { getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

type Errors = { checkInAt?: string | undefined; checkOutAt?: string | undefined; reason?: string | undefined; form?: string | undefined };

function CorrectVisitForm({ visit, onDone }: { visit: SiteVisitWithCoordinatesDto; onDone: () => void }) {
  const { timezone } = useCompany();
  const toast = useToast();
  const queryClient = useQueryClient();

  const originalIn = toCompanyTimeInput(visit.checkInAt, timezone);
  const originalOut = toCompanyTimeInput(visit.checkOutAt, timezone);
  const [checkIn, setCheckIn] = useState(originalIn);
  const [checkOut, setCheckOut] = useState(visit.checkOutAt ? originalOut : { date: originalIn.date, time: "" });
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const mutation = useMutation({
    mutationFn: (body: unknown) => api.patch(`/site-visits/${visit.id}/correct`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["site-visits"] });
      await queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.success(strings.siteVisits.correctSaved);
      onDone();
    },
    onError: (error) => {
      const fieldErrors = (error instanceof ApiClientError && error.code === "VALIDATION_ERROR"
        ? (error.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors
        : undefined) ?? null;
      if (fieldErrors) {
        setErrors({ checkInAt: fieldErrors.checkInAt?.[0], checkOutAt: fieldErrors.checkOutAt?.[0], reason: fieldErrors.reason?.[0] });
      } else {
        setErrors({ form: getErrorMessage(error) });
      }
    },
  });

  function submit() {
    const checkInAt = changedInstant(checkIn, originalIn, timezone);
    const checkOutAt = changedInstant(checkOut, visit.checkOutAt ? originalOut : { date: originalIn.date, time: "" }, timezone);

    const incomplete: Errors = {};
    if (!checkIn.date || !checkIn.time) incomplete.checkInAt = strings.corrections.incompleteTime;
    if (checkOut.time && !checkOut.date) incomplete.checkOutAt = strings.corrections.incompleteTime;
    if (visit.checkOutAt && (!checkOut.date || !checkOut.time)) incomplete.checkOutAt = strings.corrections.incompleteTime;
    if (incomplete.checkInAt || incomplete.checkOutAt) {
      setErrors(incomplete);
      return;
    }

    const parsed = CorrectSiteVisitRequestSchema.safeParse({
      ...(checkInAt ? { checkInAt } : {}),
      ...(checkOutAt ? { checkOutAt } : {}),
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
    <div className="space-y-4">
      <p className="text-xs text-slate-500">{strings.corrections.companyTimeHint(timezone)}</p>
      <CompanyTimeFields id="visit-check-in" label={strings.siteVisits.checkIn} value={checkIn} onChange={setCheckIn} error={errors.checkInAt} />
      <CompanyTimeFields id="visit-check-out" label={strings.siteVisits.checkOut} value={checkOut} onChange={setCheckOut} error={errors.checkOutAt} />
      {!visit.checkOutAt ? <p className="text-xs text-slate-500">{strings.siteVisits.closesVisit}</p> : null}
      <div className="space-y-1.5">
        <Label htmlFor="visit-reason">{strings.corrections.reason}</Label>
        <textarea
          id="visit-reason"
          className="w-full rounded-md border border-slate-300 p-2 text-sm"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-xs text-slate-500">{strings.corrections.reasonHint}</p>
        {errors.reason ? (
          <p role="alert" className="text-sm text-red-600">
            {errors.reason}
          </p>
        ) : null}
      </div>
      {errors.form ? (
        <p role="alert" className="text-sm text-red-600">
          {errors.form}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          {strings.common.cancel}
        </Button>
        <Button type="button" disabled={mutation.isPending} onClick={submit}>
          {strings.common.save}
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * One visit in full, with exact positions. Only HR and Company Admin can open it: the
 * page offers managers no way in. If a manager's request did get here, the API would
 * answer with no coordinates, so there'd be none to show.
 */
export function VisitDetailDialog({ visitId, onClose }: { visitId: string; onClose: () => void }) {
  const { user } = useAuth();
  const { timezone } = useCompany();
  const [correcting, setCorrecting] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["site-visits", "detail", visitId],
    queryFn: () => api.get<SiteVisitDetailDto>(`/site-visits/${visitId}`),
  });

  // The response's type allows both shapes. This is what a manager's would be missing.
  const visit = data?.visit as SiteVisitWithCoordinatesDto | undefined;
  const isOwn = !!visit && user?.employeeId === visit.employeeId;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto" aria-describedby={undefined}>
        <DialogTitle>{correcting ? strings.siteVisits.correctTitle : strings.siteVisits.detailTitle}</DialogTitle>
        {isLoading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error || !visit || !data ? (
          <div className="mt-4">
            <ErrorState message={strings.common.somethingWentWrong} onRetry={() => refetch()} />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <p className="font-medium text-slate-900">
                {visit.employeeName} <span className="text-sm font-normal text-slate-500">{visit.employeeCode}</span>
              </p>
              <p className="text-sm text-slate-600">
                {visit.siteName}, {formatDate(visit.workDate, timezone)}
              </p>
            </div>

            {correcting ? (
              <CorrectVisitForm visit={visit} onDone={() => setCorrecting(false)} />
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs uppercase text-slate-400">{strings.siteVisits.checkIn}</dt>
                    <dd className="mt-0.5 text-slate-900">{formatTime(visit.checkInAt, timezone)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-400">{strings.siteVisits.checkOut}</dt>
                    <dd className="mt-0.5 text-slate-900">{visit.checkOutAt ? formatTime(visit.checkOutAt, timezone) : "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-400">{strings.siteVisits.duration}</dt>
                    <dd className="mt-0.5 text-slate-900">{visit.durationMinutes !== null ? formatDuration(visit.durationMinutes) : "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-400">{strings.siteVisits.status}</dt>
                    <dd className="mt-0.5">
                      <StatusBadge status={visit.status} />
                    </dd>
                  </div>
                </dl>

                {visit.note ? (
                  <p className="whitespace-pre-line text-sm text-slate-700">
                    <span className="font-medium">{strings.siteVisits.note}:</span> {visit.note}
                  </p>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <PositionDetails
                    title={strings.position.checkInTitle}
                    latitude={visit.checkInLat}
                    longitude={visit.checkInLng}
                    accuracyM={visit.checkInAccuracyM}
                    distanceM={visit.checkInDistanceM}
                    mocked={visit.checkInMocked}
                  />
                  <PositionDetails
                    title={strings.position.checkOutTitle}
                    latitude={visit.checkOutLat}
                    longitude={visit.checkOutLng}
                    accuracyM={visit.checkOutAccuracyM}
                    distanceM={visit.checkOutDistanceM}
                    mocked={visit.checkOutMocked}
                  />
                </div>

                <CorrectionHistory corrections={data.corrections} />

                {isOwn ? <p className="text-sm text-slate-500">{strings.siteVisits.ownVisit}</p> : null}
                <DialogFooter>
                  <Button type="button" variant="secondary" onClick={onClose}>
                    {strings.common.close}
                  </Button>
                  {isOwn ? null : (
                    <Button type="button" onClick={() => setCorrecting(true)}>
                      {strings.siteVisits.correct}
                    </Button>
                  )}
                </DialogFooter>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
