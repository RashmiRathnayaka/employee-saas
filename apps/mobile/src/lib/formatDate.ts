const DEFAULT_TIMEZONE = "Asia/Colombo";

/** Formats an ISO date/datetime string as "31 Oct 2026" in the given timezone. */
export function formatDate(iso: string, timezone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(iso));
}
