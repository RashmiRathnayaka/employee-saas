import { formatTime, todayInTimezone, zonedDateTimeToUtc } from "@employee-saas/shared";

/**
 * Date and time boxes hold plain wall-clock text in the company's timezone, never the
 * browser's. HR in another country, or on a laptop set to UTC, still types the time the
 * employee's clock showed. That's why these are separate date and time boxes rather
 * than `datetime-local`, whose value a Date would read as browser time.
 */

export type CompanyTimeInput = { date: string; time: string };

/** An instant as the two boxes show it. */
export function toCompanyTimeInput(instant: string | null | undefined, timezone: string): CompanyTimeInput {
  if (!instant) return { date: "", time: "" };
  return { date: todayInTimezone(timezone, new Date(instant)), time: formatTime(instant, timezone) };
}

/** The two boxes as an instant, or null while either is empty. */
export function fromCompanyTimeInput(input: CompanyTimeInput, timezone: string): string | null {
  if (!input.date || !input.time) return null;
  return zonedDateTimeToUtc(input.date, input.time, timezone).toISOString();
}

/**
 * What to send for one time field: only what the person actually changed. The boxes
 * have no seconds, so resending an untouched 09:30:41 as 09:30:00 would look like a
 * correction nobody made. Null means there's nothing to send.
 */
export function changedInstant(current: CompanyTimeInput, original: CompanyTimeInput, timezone: string): string | null {
  if (current.date === original.date && current.time === original.time) return null;
  return fromCompanyTimeInput(current, timezone);
}
