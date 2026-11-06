import { formatDateTime, formatTime, type AttendanceCorrectionDto, type CorrectedFieldsDto } from "@employee-saas/shared";
import { useCompany } from "../lib/companyContext";
import { strings } from "../strings";

type Change = { label: string; before: string; after: string };

function changes(before: CorrectedFieldsDto | null, after: CorrectedFieldsDto, timezone: string): Change[] {
  const time = (value: string | null | undefined) => (value ? formatTime(value, timezone) : strings.corrections.none);
  const status = (value: string | undefined) =>
    value ? (strings.attendance.statuses[value as keyof typeof strings.attendance.statuses] ?? value) : strings.corrections.none;
  const list: Change[] = [];
  if ("checkInAt" in after) list.push({ label: strings.corrections.checkIn, before: time(before?.checkInAt), after: time(after.checkInAt) });
  if ("checkOutAt" in after) list.push({ label: strings.corrections.checkOut, before: time(before?.checkOutAt), after: time(after.checkOutAt) });
  if ("siteName" in after) {
    list.push({ label: strings.corrections.office, before: before?.siteName ?? strings.corrections.none, after: after.siteName ?? strings.corrections.none });
  }
  if ("status" in after) list.push({ label: strings.corrections.status, before: status(before?.status), after: status(after.status) });
  return list;
}

/** "Corrected by HR on ...: reason", newest first, without anyone reading the audit log. */
export function CorrectionHistory({ corrections }: { corrections: AttendanceCorrectionDto[] }) {
  const { timezone } = useCompany();

  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-900">{strings.corrections.title}</h3>
      {corrections.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{strings.corrections.empty}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {corrections.map((correction) => (
            <li key={correction.id} className="rounded-md bg-slate-50 p-3 text-sm">
              <p className="text-xs text-slate-500">
                {strings.corrections.by(correction.correctedByName, formatDateTime(correction.createdAt, timezone))}
              </p>
              <p className="mt-1 text-slate-900">{correction.reason}</p>
              {correction.before === null ? <p className="mt-1 text-xs font-medium text-slate-600">{strings.corrections.created}</p> : null}
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {changes(correction.before, correction.after, timezone).map((change) => (
                  <li key={change.label}>
                    {correction.before === null ? `${change.label}: ${change.after}` : `${change.label}: ${change.before} → ${change.after}`}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
