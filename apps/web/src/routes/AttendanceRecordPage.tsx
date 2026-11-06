import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatTime,
  type AttendanceRecordDetailDto,
  type AttendanceRecordWithCoordinatesDto,
  type SiteVisitDto,
} from "@employee-saas/shared";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { CorrectAttendanceDialog } from "../components/AttendanceDialogs";
import { AttendanceFlags } from "../components/AttendanceFlags";
import { CorrectionHistory } from "../components/CorrectionHistory";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PositionDetails } from "../components/PositionDetails";
import { StatusBadge } from "../components/StatusBadge";
import { VisitDetailDialog } from "../components/VisitDetailDialog";
import { api, ApiClientError } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { useCompany } from "../lib/companyContext";
import { strings } from "../strings";


function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{value}</dd>
    </div>
  );
}

function withinText(distanceM: number | null, withinRadius: boolean | null): string {
  if (distanceM === null) return strings.siteVisits.notChecked;
  return `${formatDistance(distanceM)}, ${withinRadius ? strings.siteVisits.within : strings.siteVisits.outside}`;
}

function VisitRow({ visit, timezone, onOpen }: { visit: SiteVisitDto; timezone: string; onOpen?: (() => void) | undefined }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0">
      <div>
        <p className="font-medium text-slate-900">{visit.siteName}</p>
        <p className="text-xs text-slate-500">
          {formatTime(visit.checkInAt, timezone)} - {visit.checkOutAt ? formatTime(visit.checkOutAt, timezone) : "-"}
          {visit.durationMinutes !== null ? `, ${formatDuration(visit.durationMinutes)}` : ""}
          {`, ${withinText(visit.checkInDistanceM, visit.checkInWithinRadius)}`}
        </p>
        {visit.flags.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {visit.flags.map((flag) => (
              <span key={flag} className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {strings.siteVisits.flags[flag]}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {onOpen ? (
        <Button type="button" variant="secondary" size="sm" aria-label={`${strings.siteVisits.details}: ${visit.siteName}`} onClick={onOpen}>
          {strings.siteVisits.details}
        </Button>
      ) : null}
    </li>
  );
}

/** One day in full: visits, history and, for HR and Company Admin, exact positions.
 * Managers get "were they at the site?" and no position, as in every other view. */
export function AttendanceRecordPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { timezone } = useCompany();
  const [correcting, setCorrecting] = useState(false);
  const [openVisitId, setOpenVisitId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["attendance", "detail", id],
    queryFn: () => api.get<AttendanceRecordDetailDto>(`/attendance/${id}`),
  });

  const isAdmin = user?.role === "HR" || user?.role === "COMPANY_ADMIN";
  // An employee has no attendance page to go back to, only this record.
  const showBack = isAdmin || user?.role === "MANAGER";

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error instanceof ApiClientError && error.code === "MODULE_DISABLED") {
    return <EmptyState title={strings.attendance.moduleOff} description={strings.attendance.moduleOffHint} />;
  }
  if (error instanceof ApiClientError && error.code === "NOT_FOUND") {
    return <EmptyState title={strings.notFound.title} description={strings.errors.NOT_FOUND} />;
  }
  if (error || !data) {
    return <ErrorState message={strings.common.somethingWentWrong} onRetry={() => refetch()} />;
  }

  const { record, employee, siteName, siteVisits, corrections } = data;
  // What the API sent: absent for a manager. Only shown to those allowed positions.
  const withCoordinates = record as AttendanceRecordWithCoordinatesDto;
  const isOwn = user?.employeeId === record.employeeId;

  return (
    <div className="space-y-6">
      {showBack ? (
        <Link className="block text-sm text-[var(--color-primary)] hover:underline" to="/attendance">
          {strings.attendance.back}
        </Link>
      ) : null}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle>
              {employee.name}, {formatDate(record.workDate, timezone)}
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">{employee.code}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={record.status} />
            {isAdmin && !isOwn ? (
              <Button size="sm" onClick={() => setCorrecting(true)}>
                {strings.attendance.correct}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {isAdmin && isOwn ? <p className="mb-4 text-sm text-slate-500">{strings.attendance.ownRecord}</p> : null}
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <Field
              label={strings.attendance.schedule}
              value={
                record.scheduledStartAt && record.scheduledEndAt
                  ? `${formatTime(record.scheduledStartAt, timezone)} - ${formatTime(record.scheduledEndAt, timezone)}`
                  : "-"
              }
            />
            <Field label={strings.attendance.checkIn} value={record.checkInAt ? formatTime(record.checkInAt, timezone) : "-"} />
            <Field label={strings.attendance.checkOut} value={record.checkOutAt ? formatTime(record.checkOutAt, timezone) : "-"} />
            <Field label={strings.attendance.worked} value={record.workedMinutes !== null ? formatDuration(record.workedMinutes) : "-"} />
            <Field label={strings.attendance.late} value={record.lateMinutes > 0 ? formatDuration(record.lateMinutes) : "-"} />
            <Field label={strings.attendance.earlyLeave} value={record.earlyLeaveMinutes > 0 ? formatDuration(record.earlyLeaveMinutes) : "-"} />
            <Field label={strings.attendance.office} value={siteName ?? "-"} />
            <Field label={strings.attendance.source} value={strings.attendance.sources[record.source]} />
            <Field label={strings.siteVisits.location} value={withinText(record.checkInDistanceM, record.checkInWithinRadius)} />
          </dl>
          <div className="mt-4">
            <p className="text-xs uppercase text-slate-400">{strings.attendance.flagsTitle}</p>
            <div className="mt-1">
              <AttendanceFlags flags={record.flags} />
            </div>
          </div>
          {record.isCorrected ? <p className="mt-3 text-sm font-medium text-amber-700">{strings.attendance.corrected}</p> : null}
        </CardContent>
      </Card>

      {isAdmin ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <PositionDetails
            title={strings.position.checkInTitle}
            latitude={withCoordinates.checkInLat}
            longitude={withCoordinates.checkInLng}
            accuracyM={record.checkInAccuracyM}
            distanceM={record.checkInDistanceM}
            mocked={record.checkInMocked}
          />
          <PositionDetails
            title={strings.position.checkOutTitle}
            latitude={withCoordinates.checkOutLat}
            longitude={withCoordinates.checkOutLng}
            accuracyM={record.checkOutAccuracyM}
            distanceM={record.checkOutDistanceM}
            mocked={record.checkOutMocked}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{strings.attendance.siteVisitsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {siteVisits.length === 0 ? (
            <p className="text-sm text-slate-500">{strings.attendance.noSiteVisits}</p>
          ) : (
            <ul>
              {siteVisits.map((visit) => (
                <VisitRow key={visit.id} visit={visit} timezone={timezone} onOpen={isAdmin ? () => setOpenVisitId(visit.id) : undefined} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <CorrectionHistory corrections={corrections} />
        </CardContent>
      </Card>

      {correcting ? <CorrectAttendanceDialog record={record} onClose={() => setCorrecting(false)} /> : null}
      {isAdmin && openVisitId ? <VisitDetailDialog visitId={openVisitId} onClose={() => setOpenVisitId(null)} /> : null}
    </div>
  );
}
