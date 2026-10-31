import { cn } from "../lib/cn";

const ACTIVE_VALUES = new Set(["ACTIVE", "APPROVED", "ACCEPTED"]);
const WARN_VALUES = new Set(["PENDING_MANAGER", "PENDING_HR", "MISSING", "PENDING_REVIEW", "INFO_REQUIRED"]);
const NEGATIVE_VALUES = new Set(["DEACTIVATED", "INACTIVE", "REJECTED", "CANCELLED", "REVOKED", "SUSPENDED"]);

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        ACTIVE_VALUES.has(status) && "bg-emerald-100 text-emerald-700",
        WARN_VALUES.has(status) && "bg-amber-100 text-amber-700",
        NEGATIVE_VALUES.has(status) && "bg-slate-200 text-slate-700",
        !ACTIVE_VALUES.has(status) && !WARN_VALUES.has(status) && !NEGATIVE_VALUES.has(status) && "bg-slate-100 text-slate-600",
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
