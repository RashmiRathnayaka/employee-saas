import { housekeepingJob } from "./lib/jobs/housekeeping.js";
import type { Job, PlatformJob } from "./lib/jobs/runner.js";
import { checkinReminderJob } from "./modules/attendance/checkinReminder.job.js";
import { dayCloseJob, visitAutoCloseJob } from "./modules/attendance/dayClose.job.js";
import { gpsPurgeJob } from "./modules/attendance/gpsPurge.job.js";
import { proofDueTomorrowJob, proofOverdueJob } from "./modules/leaveRequests/proofReminders.job.js";

/** Every per-company job the worker runs, in order. Day close goes first, so a reminder
 * never goes to someone whose day has just been closed. Push jobs come in step 2.9b. */
export const JOBS: Job[] = [dayCloseJob, visitAutoCloseJob, checkinReminderJob, proofDueTomorrowJob, proofOverdueJob, gpsPurgeJob];

/** Jobs for the whole platform, run once per tick before the companies'. */
export const PLATFORM_JOBS: PlatformJob[] = [housekeepingJob];
