/**
 * Calendar-date helpers shared by api, web and mobile.
 *
 * Two kinds of "date" exist in this system, and mixing them up is what
 * causes off-by-one-day bugs:
 *
 * 1. **Calendar dates** ("YYYY-MM-DD" strings) - a leave's start/end date,
 *    a holiday, a joining date. They have NO time and NO timezone: "the
 *    15th" is the 15th everywhere. Postgres stores them as `date`; Prisma
 *    hands them back as a JS Date at UTC midnight.
 * 2. **Timestamps** (full ISO strings like "2026-11-03T18:45:00.000Z") -
 *    when something happened (createdAt, decidedAt). These are a single
 *    instant, stored in UTC, and only become a calendar day once you pick
 *    a timezone to look at them from.
 *
 * The classic bug: `someDate.toISOString().slice(0, 10)` converts to UTC
 * first, so a local midnight in Colombo (UTC+5:30) becomes 18:30 the day
 * before in UTC - the wrong calendar day. Rule of thumb:
 * - Turning a *picked local date* into "YYYY-MM-DD" -> `toLocalIsoDate`.
 * - "What day is it today for this company?" -> `todayInTimezone`.
 * - Arithmetic on "YYYY-MM-DD" -> `addDaysToIsoDate` / `daysBetweenIsoDates`
 *   (done in UTC internally, so the device/server timezone never matters).
 */

export const DEFAULT_TIMEZONE = "Asia/Colombo";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a plain calendar date "YYYY-MM-DD" (no time part). */
export function isIsoDate(value: string): boolean {
  return ISO_DATE_RE.test(value);
}

function parseIsoDateParts(isoDate: string): { year: number; month: number; day: number } {
  const match = ISO_DATE_RE.exec(isoDate);
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, got "${isoDate}"`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** "YYYY-MM-DD" -> a Date at UTC midnight of that day. This is exactly the
 * shape Prisma uses for `@db.Date` columns, so it's what the API passes to
 * queries. Independent of the server's timezone. */
export function isoDateToUtcDate(isoDate: string): Date {
  const { year, month, day } = parseIsoDateParts(isoDate);
  return new Date(Date.UTC(year, month - 1, day));
}

/** The inverse of `isoDateToUtcDate`: a UTC-midnight Date (e.g. a Prisma
 * `@db.Date` value) -> "YYYY-MM-DD". Using `toISOString()` here is correct,
 * because the value already *is* UTC midnight - don't use this on a Date
 * built from a local-time picker; use `toLocalIsoDate` for that. */
export function utcDateToIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A Date's calendar day in the *runtime's own* local timezone (the
 * device's, for a phone or browser) as "YYYY-MM-DD". Use this for the value
 * a native date picker returns - it hands back local midnight of the tapped
 * day, which `toISOString()` would shift to the previous day anywhere east
 * of UTC. */
export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** "YYYY-MM-DD" -> a Date at *local* midnight of that day (the shape a
 * native date picker expects for `value`/`minimumDate`). */
export function isoDateToLocalDate(isoDate: string): Date {
  const { year, month, day } = parseIsoDateParts(isoDate);
  return new Date(year, month - 1, day);
}

/** Today's calendar date in an IANA timezone (e.g. "Asia/Colombo"), as
 * "YYYY-MM-DD". The API uses this with `companies.timezone` so "today"
 * means the company's today - not the server's, and not UTC's. `now` is
 * injectable for tests. */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The current calendar year in an IANA timezone (for "this year's leave
 * balances" - on 1 Jan at 00:15 in Colombo, UTC is still on 31 Dec). */
export function currentYearInTimezone(timezone: string, now: Date = new Date()): number {
  return Number(todayInTimezone(timezone, now).slice(0, 4));
}

/** "YYYY-MM-DD" shifted by `days` (negative for the past). Pure calendar
 * arithmetic, done in UTC so neither the runtime's timezone nor a
 * daylight-saving change can skew it. */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = isoDateToUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateToIsoDate(date);
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetweenIsoDates(from: string, to: string): number {
  return Math.round((isoDateToUtcDate(to).getTime() - isoDateToUtcDate(from).getTime()) / 86_400_000);
}

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ONE_DAY_MS = 86_400_000;

// Building an Intl.DateTimeFormat is slow, and a job may convert thousands
// of times per tick, so keep one per timezone.
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function getOffsetFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    offsetFormatters.set(timezone, formatter);
  }
  return formatter;
}

/** How far ahead of UTC `timezone` is at this instant, in ms (Colombo is
 * +19,800,000). It's worked out by asking Intl what the wall clock shows
 * there, then reading that wall clock as if it were UTC. */
function timezoneOffsetMs(timezone: string, instantMs: number): number {
  const fields: Record<string, number> = {};
  for (const part of getOffsetFormatter(timezone).formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  const wallClockAsUtc = Date.UTC(
    fields.year!,
    fields.month! - 1,
    fields.day!,
    fields.hour! % 24,
    fields.minute!,
    fields.second!,
  );
  return wallClockAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * "2026-11-03" + "09:00" on the wall clock in `timezone` -> the exact instant
 * that is, as a Date. This is the inverse of showing a timestamp in a
 * timezone. The result doesn't depend on the server's or device's own TZ.
 *
 * A timezone's offset can change on the days clocks change, so the offsets a
 * day before and a day after are both tried:
 * - **A time that happens twice** (clocks go back): the first one.
 * - **A time that doesn't exist** (clocks jump forward): moved forward by the
 *   size of the jump, so London's 01:30 on the spring change means 02:30 BST.
 *
 * Throws on a malformed or impossible date or time, or an unknown timezone.
 */
export function zonedDateTimeToUtc(isoDate: string, time: string, timezone: string): Date {
  const { year, month, day } = parseIsoDateParts(isoDate);
  const timeMatch = TIME_OF_DAY_RE.exec(time);
  if (!timeMatch) throw new Error(`Expected an HH:mm time, got "${time}"`);
  // Date.UTC rolls 30 Feb over to March without complaint, so catch it here.
  if (utcDateToIsoDate(isoDateToUtcDate(isoDate)) !== isoDate) {
    throw new Error(`"${isoDate}" is not a real calendar date`);
  }

  const wallClockAsUtc = Date.UTC(year, month - 1, day, Number(timeMatch[1]), Number(timeMatch[2]));
  const offsetBefore = timezoneOffsetMs(timezone, wallClockAsUtc - ONE_DAY_MS);
  const offsetAfter = timezoneOffsetMs(timezone, wallClockAsUtc + ONE_DAY_MS);

  // The larger offset gives the earlier instant, so trying it first is what
  // picks "the first one" when a time happens twice.
  for (const offset of [Math.max(offsetBefore, offsetAfter), Math.min(offsetBefore, offsetAfter)]) {
    const candidate = wallClockAsUtc - offset;
    if (timezoneOffsetMs(timezone, candidate) === offset) return new Date(candidate);
  }
  // Neither offset is in force at that wall-clock time, so it doesn't exist.
  // Reading it with the old offset lands the same distance past the jump.
  return new Date(wallClockAsUtc - offsetBefore);
}

/** A shift's start and end instants for the date it starts on. An end time at
 * or before the start time means the shift crosses midnight, so it ends on
 * the next calendar day. */
export function getShiftInstants(params: {
  workDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
}): { scheduledStartAt: Date; scheduledEndAt: Date } {
  const { workDate, startTime, endTime, timezone } = params;
  const endDate = endTime <= startTime ? addDaysToIsoDate(workDate, 1) : workDate;
  return {
    scheduledStartAt: zonedDateTimeToUtc(workDate, startTime, timezone),
    scheduledEndAt: zonedDateTimeToUtc(endDate, endTime, timezone),
  };
}

/**
 * The work date a check-in at `now` belongs to: the company-local date the
 * shift *starts* on (architecture-phase2 §1.3). A check-in at 00:20 during a
 * 22:00-06:00 shift belongs to yesterday.
 *
 * `previousDaySchedule` is the employee's effective schedule for the day
 * before today (company time). Pass null if yesterday was a non-working day,
 * since no shift from it can still be running. The caller looks it up, using
 * `todayInTimezone` and `addDaysToIsoDate`, so this stays pure and testable.
 *
 * The end of the shift is the cut-off, exclusive. This answers "which shift is
 * a *check-in* for", so it isn't how to find the record to check out of: a
 * night worker checking out late, after 06:00, gets today's date here.
 */
export function getWorkDate(params: {
  now: Date;
  timezone: string;
  previousDaySchedule: { startTime: string; endTime: string } | null;
}): string {
  const { now, timezone, previousDaySchedule } = params;
  const today = todayInTimezone(timezone, now);
  if (previousDaySchedule && previousDaySchedule.endTime <= previousDaySchedule.startTime) {
    const yesterday = addDaysToIsoDate(today, -1);
    const { scheduledEndAt } = getShiftInstants({ workDate: yesterday, ...previousDaySchedule, timezone });
    if (now.getTime() < scheduledEndAt.getTime()) return yesterday;
  }
  return today;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };

/**
 * Formats a date for display as "31 Oct 2026".
 * - A calendar date ("YYYY-MM-DD") is shown as that exact day, whatever
 *   the timezone - "the 15th" never turns into "the 14th".
 * - A timestamp is shown as its calendar day in `timezone` (the company's).
 */
export function formatDate(value: string, timezone: string = DEFAULT_TIMEZONE): string {
  if (isIsoDate(value)) {
    return new Intl.DateTimeFormat("en-GB", { ...DATE_FORMAT, timeZone: "UTC" }).format(isoDateToUtcDate(value));
  }
  return new Intl.DateTimeFormat("en-GB", { ...DATE_FORMAT, timeZone: timezone }).format(new Date(value));
}

/** Formats a timestamp as "31 Oct 2026, 14:05" in `timezone`. */
export function formatDateTime(value: string, timezone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    ...DATE_FORMAT,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(value));
}
