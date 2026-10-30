import { ApiError } from "./errors.js";

export type WorkDayWeight = "FULL" | "HALF" | "OFF";

export type WorkingDaysConfig = {
  mon: WorkDayWeight;
  tue: WorkDayWeight;
  wed: WorkDayWeight;
  thu: WorkDayWeight;
  fri: WorkDayWeight;
  sat: WorkDayWeight;
  sun: WorkDayWeight;
};

const DAY_KEYS: Array<keyof WorkingDaysConfig> = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEIGHTS: Record<WorkDayWeight, number> = { FULL: 1, HALF: 0.5, OFF: 0 };

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Sums each calendar day's working weight (FULL=1, HALF=0.5, OFF=0; a
 * holiday overrides to 0 regardless of workingDays) across [startDate,
 * endDate] inclusive, halving the start/end day's weight when its
 * half-day flag is set. Throws ApiError(400) if the inputs don't make
 * sense (end before start, both half-day flags on a single-day request,
 * or a result of 0 - nothing to take leave from on an all-non-working
 * range). Dates are plain UTC-midnight Date objects (as Prisma returns
 * for @db.Date columns) - this function does no timezone conversion.
 */
export function calculateLeaveDays(params: {
  startDate: Date;
  endDate: Date;
  startHalfDay: boolean;
  endHalfDay: boolean;
  workingDays: WorkingDaysConfig;
  holidays: ReadonlySet<string>;
}): number {
  const { startDate, endDate, startHalfDay, endHalfDay, workingDays, holidays } = params;

  if (endDate.getTime() < startDate.getTime()) {
    throw new ApiError(400, "INVALID_LEAVE_RANGE", "endDate must not be before startDate.");
  }

  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);
  const isSingleDay = startKey === endKey;

  if (isSingleDay && startHalfDay && endHalfDay) {
    throw new ApiError(
      400,
      "INVALID_LEAVE_RANGE",
      "Only one half-day flag is allowed for a single-day request.",
    );
  }

  let total = 0;
  const cursor = new Date(startDate.getTime());
  while (cursor.getTime() <= endDate.getTime()) {
    const dateKey = toDateKey(cursor);
    const dayKey = DAY_KEYS[cursor.getUTCDay()]!;
    const weight = holidays.has(dateKey) ? 0 : WEIGHTS[workingDays[dayKey]];

    let contribution = weight;
    if (dateKey === startKey && startHalfDay) contribution = weight / 2;
    if (dateKey === endKey && endHalfDay) contribution = weight / 2;

    total += contribution;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  total = Math.round(total * 100) / 100;

  if (total <= 0) {
    throw new ApiError(
      400,
      "INVALID_LEAVE_RANGE",
      "This range has no working days to take leave from (totalDays must be greater than 0).",
    );
  }

  return total;
}

const DEFAULT_WORKING_DAYS: WorkingDaysConfig = {
  mon: "FULL",
  tue: "FULL",
  wed: "FULL",
  thu: "FULL",
  fri: "FULL",
  sat: "HALF",
  sun: "OFF",
};

/** company_settings.workingDays is a free-form JSON column (validated only
 * loosely by the PATCH schema), so this defensively fills in any missing
 * or malformed day with the same default the column itself defaults to -
 * calculateLeaveDays should never crash on a day key it doesn't recognize. */
export function normalizeWorkingDays(raw: unknown): WorkingDaysConfig {
  const result = { ...DEFAULT_WORKING_DAYS };
  if (typeof raw !== "object" || raw === null) return result;

  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_WORKING_DAYS) as Array<keyof WorkingDaysConfig>) {
    const value = input[key];
    if (value === "FULL" || value === "HALF" || value === "OFF") {
      result[key] = value;
    }
  }
  return result;
}

/** "Today" as a YYYY-MM-DD string in the given IANA timezone - used for
 * past-date and single-year validation, which must respect the company's
 * local calendar date, not the server's or the client's. */
export function getTodayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
