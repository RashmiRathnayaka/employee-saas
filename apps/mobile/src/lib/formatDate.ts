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

/** Formats a Date as the local calendar day "YYYY-MM-DD" - deliberately
 * NOT `date.toISOString()`, which converts to UTC first and lands on the
 * wrong day whenever the device's local time and UTC fall on different
 * calendar dates (any time the local UTC offset isn't 0, for part of the
 * day). A date picker's selected day must round-trip as the exact day the
 * user tapped, in the device's own timezone. */
export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today's date in the device's local timezone, as "YYYY-MM-DD". */
export function todayLocalIsoDate(): string {
  return toLocalIsoDate(new Date());
}

/** `isoDate` shifted by `days` (negative for the past), preserving local
 * calendar-day semantics across month/year boundaries. */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalIsoDate(date);
}
