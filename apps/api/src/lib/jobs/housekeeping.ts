import { platformPrisma } from "../prisma.js";
import { HEARTBEAT_JOB_NAME, type PlatformJob } from "./runner.js";
import { getDueDailyKeys, HOUSEKEEPING_CATCH_UP_MS } from "./schedule.js";

/**
 * Housekeeping: architecture-phase2 §5.4. Once a day at 04:00 UTC, for the whole
 * platform. It deletes `job_runs` rows older than 30 days, never the worker's heartbeat.
 *
 * Nothing still due can need an old claim: day close looks back 2 days, and the daily
 * jobs at most a day. So a deleted row can't let a run happen twice.
 *
 * `push_messages` (older than 30 days) and `push_devices` (unseen for 60 days) join this
 * in step 2.9b, when those tables exist.
 */

const ONE_DAY_MS = 24 * 60 * 60_000;
export const JOB_RUNS_KEPT_DAYS = 30;
export const HOUSEKEEPING_TIME_UTC = "04:00";

export const housekeepingJob: PlatformJob = {
  name: "housekeeping",
  dueRunKeys(now) {
    return getDueDailyKeys({ now, timezone: "UTC", time: HOUSEKEEPING_TIME_UTC, catchUpMs: HOUSEKEEPING_CATCH_UP_MS });
  },
  async run(now) {
    await platformPrisma.jobRun.deleteMany({
      where: { startedAt: { lt: new Date(now.getTime() - JOB_RUNS_KEPT_DAYS * ONE_DAY_MS) }, jobName: { not: HEARTBEAT_JOB_NAME } },
    });
  },
};
