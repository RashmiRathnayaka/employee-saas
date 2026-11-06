import type { AttendanceFlag } from "@employee-saas/shared";
import { strings } from "../strings";

function Chip({ children }: { children: string }) {
  return <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{children}</span>;
}

/** A record's flags in plain words, and the visit flag the list adds to an ABSENT row. */
export function AttendanceFlags({ flags, siteVisitFlags = [] }: { flags: AttendanceFlag[]; siteVisitFlags?: "ON_ABSENT_DAY"[] }) {
  if (flags.length === 0 && siteVisitFlags.length === 0) return <span className="text-slate-400">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {siteVisitFlags.map((flag) => (
        <Chip key={flag}>{strings.attendance.siteVisitFlags[flag]}</Chip>
      ))}
      {flags.map((flag) => (
        <Chip key={flag}>{strings.attendance.flags[flag]}</Chip>
      ))}
    </div>
  );
}
