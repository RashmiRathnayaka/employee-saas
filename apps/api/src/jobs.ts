import type { Job } from "./lib/jobs/runner.js";
import { dayCloseJob, visitAutoCloseJob } from "./modules/attendance/dayClose.job.js";

/** Every job the worker runs, in order. Reminders and housekeeping come in step 2.8. */
export const JOBS: Job[] = [dayCloseJob, visitAutoCloseJob];
