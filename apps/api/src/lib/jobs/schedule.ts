import { addDaysToIsoDate, todayInTimezone, zonedDateTimeToUtc } from "@employee-saas/shared";

/**
 * When a "daily at HH:mm" job is due: architecture-phase2 §5.4. Pure, so a test can
 * hand it any clock.
 */

export const ONE_HOUR_MS = 60 * 60_000;
/** A reminder this late is useless, so it's skipped rather than sent (§5.4). */
export const REMINDER_CATCH_UP_MS = 2 * ONE_HOUR_MS;
/** Housekeeping that's late still matters: the next run picks up whatever was missed. */
export const HOUSEKEEPING_CATCH_UP_MS = 24 * ONE_HOUR_MS;

/**
 * The local dates whose `time` has come within the last `catchUpMs`, oldest first: each
 * is a run key. Yesterday is looked at too, so 23:30 still runs when the worker gets to
 * it at 00:10. A worker that was down for longer than `catchUpMs` skips that date.
 */
export function getDueDailyKeys(params: { now: Date; timezone: string; time: string; catchUpMs: number }): string[] {
  const { now, timezone, time, catchUpMs } = params;
  const today = todayInTimezone(timezone, now);
  return [addDaysToIsoDate(today, -1), today].filter((date) => {
    const dueAt = zonedDateTimeToUtc(date, time, timezone).getTime();
    return dueAt <= now.getTime() && now.getTime() - dueAt < catchUpMs;
  });
}
