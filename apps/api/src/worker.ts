import { config } from "./config.js";
import { JOBS, PLATFORM_JOBS } from "./jobs.js";
import { runTick, sanitiseError, TICK_INTERVAL_MS } from "./lib/jobs/runner.js";
import { logger } from "./lib/logger.js";
import { platformPrisma } from "./lib/prisma.js";

/**
 * The background worker: a second process from the same code, so a slow job never slows
 * down a request. See docs/phase2/architecture-phase2.md §5.
 *
 *   pnpm --filter @employee-saas/api worker          keeps running (`pnpm dev` starts this)
 *   pnpm --filter @employee-saas/api worker --once   one tick and exit, for trying a job
 *
 * Running two is safe, and is what a second server would do.
 */

async function tick(): Promise<void> {
  try {
    await runTick(JOBS, new Date(), PLATFORM_JOBS);
  } catch (err) {
    // A database outage, say. The loop carries on and the next tick tries again.
    logger.error({ lastError: sanitiseError(err) }, "Worker tick failed");
  }
}

async function main(): Promise<void> {
  if (!config.JOBS_ENABLED) {
    logger.info("JOBS_ENABLED=false, so this worker won't run any jobs");
    return;
  }

  if (process.argv.includes("--once")) {
    await tick();
    await platformPrisma.$disconnect();
    return;
  }

  logger.info(`Worker started: a tick every ${TICK_INTERVAL_MS / 1000} s`);
  let stopping = false;
  let endWait = () => {};

  const stop = () => {
    stopping = true;
    endWait();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  // The next wait starts after a tick ends, so a slow tick can't overlap itself. A tick
  // in progress finishes first: anything it hadn't got to is picked up by the next run.
  while (!stopping) {
    await tick();
    if (stopping) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, TICK_INTERVAL_MS);
      endWait = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
  await platformPrisma.$disconnect();
  logger.info("Worker stopped");
}

void main();
