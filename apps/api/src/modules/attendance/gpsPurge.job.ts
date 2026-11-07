import type { Job } from "../../lib/jobs/runner.js";
import { getDueDailyKeys, HOUSEKEEPING_CATCH_UP_MS } from "../../lib/jobs/schedule.js";
import { logger } from "../../lib/logger.js";

/**
 * The GPS purge: architecture-phase2 §3.5. Once a day at 03:00 company time, raw
 * coordinates older than `gpsRetentionDays` are set to NULL on attendance records and
 * site visits.
 *
 * **It only clears the four coordinate columns. It never deletes a row.** Distance,
 * within-radius, accuracy, flags and times stay: they're the employment record.
 *
 * It runs whatever the modules are set to, and for a suspended company too, because the
 * retention promise in the app's location notice doesn't depend on either.
 */

const ONE_DAY_MS = 24 * 60 * 60_000;
export const GPS_PURGE_TIME = "03:00";

const CLEARED = { checkInLat: null, checkInLng: null, checkOutLat: null, checkOutLng: null };

/** First the rows the partial index on (companyId, checkInAt) WHERE checkInLat IS NOT NULL
 * finds. Then the rare row with only a check-out position, where the site's GPS was
 * switched on between the check-in and the check-out. */
function wherePasses(companyId: string, cutoff: Date) {
  const old = { companyId, checkInAt: { lt: cutoff } };
  return [
    { ...old, checkInLat: { not: null } },
    { ...old, checkInLat: null, OR: [{ checkInLng: { not: null } }, { checkOutLat: { not: null } }, { checkOutLng: { not: null } }] },
  ];
}

export const gpsPurgeJob: Job = {
  name: "gps.purge",
  runsWhileSuspended: true,
  async dueRunKeys({ company, now }) {
    return getDueDailyKeys({ now, timezone: company.timezone, time: GPS_PURGE_TIME, catchUpMs: HOUSEKEEPING_CATCH_UP_MS });
  },
  async run({ tenant, company, settings, now }) {
    const cutoff = new Date(now.getTime() - settings.gpsRetentionDays * ONE_DAY_MS);
    let records = 0;
    let visits = 0;
    for (const where of wherePasses(company.id, cutoff)) {
      records += (await tenant.attendanceRecord.updateMany({ where, data: CLEARED })).count;
      visits += (await tenant.siteVisit.updateMany({ where, data: CLEARED })).count;
    }
    // Counts only: never a position.
    if (records + visits > 0) logger.info({ companyId: company.id, records, visits }, "GPS purge cleared old coordinates");
  },
};
