import { isModuleEnabled, type CompanyModule } from "@employee-saas/shared";
import type { Company, CompanySettings } from "@prisma/client";
import { logger } from "../logger.js";
import { platformPrisma } from "../prisma.js";
import { getTenantPrisma, type TenantPrisma } from "../tenantPrisma.js";

/**
 * The job runner: architecture-phase2 §5. A tick asks each job what's due for each
 * company and runs it, one company at a time.
 *
 * `now` is passed in and never read from the clock inside a job, so a test can run "the
 * day at 23:59 in Colombo" whenever it likes.
 */

export const TICK_INTERVAL_MS = 30_000;
const STUCK_AFTER_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;
const LAST_ERROR_MAX_LENGTH = 200;
/** The worker's one row saying it's alive. It's updated, so it doesn't grow. */
const HEARTBEAT = { jobName: "worker.tick", runKey: "heartbeat" };
/** `/health` calls the worker down if its last tick is older than this. */
const WORKER_OK_WITHIN_MS = 2 * 60_000;

export type JobContext = {
  tenant: TenantPrisma;
  company: Pick<Company, "id" | "timezone">;
  settings: CompanySettings;
  now: Date;
};

export type Job = {
  name: string;
  /** Skipped for a company with this module off (§0). */
  module?: CompanyModule;
  /** Runs on every tick with no claim, so it must be cheap and idempotent. */
  everyTick?(context: JobContext): Promise<void>;
  /** What should have run by now. Each key runs once, whichever worker claims it. */
  dueRunKeys?(context: JobContext): Promise<string[]>;
  run?(context: JobContext, runKey: string): Promise<void>;
};

type RunId = { jobName: string; companyId: string | null; runKey: string };

/**
 * Tries to become the one worker running this. A claim row behaves like any other row,
 * unlike a session advisory lock, which belongs to one connection in Prisma's pool.
 *
 * The first insert wins. After that, only a run that failed, or has been RUNNING so long
 * its worker must have died, can be taken again, up to MAX_ATTEMPTS. Each step is one
 * statement, so two workers can't both get a yes.
 */
export async function claimRun(id: RunId, now: Date): Promise<boolean> {
  const inserted = await platformPrisma.jobRun.createMany({
    data: [{ ...id, status: "RUNNING", attempts: 1, startedAt: now }],
    skipDuplicates: true,
  });
  if (inserted.count === 1) return true;

  const retaken = await platformPrisma.jobRun.updateMany({
    where: {
      ...id,
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ status: "FAILED" }, { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } }],
    },
    data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: now, finishedAt: null },
  });
  return retaken.count === 1;
}

/** Only a code and a short message. A Prisma error's message can quote the query's
 * values, so for those it's the code alone: this column must never hold row data. */
export function sanitiseError(err: unknown): string {
  if (!(err instanceof Error)) return "UNKNOWN_ERROR";
  const code = (err as { code?: unknown }).code;
  if (err.name.startsWith("PrismaClient")) return typeof code === "string" ? code : err.name;
  const firstLine = err.message.split("\n")[0] ?? "";
  return `${typeof code === "string" ? code : err.name}: ${firstLine}`.slice(0, LAST_ERROR_MAX_LENGTH);
}

async function runClaimed(job: Job, context: JobContext, runKey: string): Promise<void> {
  const id: RunId = { jobName: job.name, companyId: context.company.id, runKey };
  if (!(await claimRun(id, context.now))) return;

  try {
    await job.run!(context, runKey);
    await platformPrisma.jobRun.updateMany({ where: id, data: { status: "DONE", finishedAt: context.now, lastError: null } });
  } catch (err) {
    const lastError = sanitiseError(err);
    await platformPrisma.jobRun.updateMany({ where: id, data: { status: "FAILED", finishedAt: context.now, lastError } });
    // The object, not `err`: the logger must not get row data either.
    logger.error({ ...id, lastError }, "Job failed");
  }
}

async function runJobForCompany(job: Job, context: JobContext): Promise<void> {
  // Its own try/catch per job per company (§5.5): one failure stops nothing else.
  try {
    await job.everyTick?.(context);
    if (job.dueRunKeys && job.run) {
      for (const runKey of await job.dueRunKeys(context)) await runClaimed(job, context, runKey);
    }
  } catch (err) {
    logger.error({ jobName: job.name, companyId: context.company.id, lastError: sanitiseError(err) }, "Job failed");
  }
}

async function writeHeartbeat(now: Date): Promise<void> {
  const where = { ...HEARTBEAT, companyId: null };
  const updated = await platformPrisma.jobRun.updateMany({ where, data: { startedAt: now, finishedAt: now } });
  if (updated.count === 0) {
    await platformPrisma.jobRun.createMany({
      data: [{ ...HEARTBEAT, status: "DONE", startedAt: now, finishedAt: now }],
      skipDuplicates: true,
    });
  }
}

/** One pass over every active company. A suspended company runs nothing. */
export async function runTick(jobs: Job[], now: Date): Promise<void> {
  await writeHeartbeat(now);

  const companies = await platformPrisma.company.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, timezone: true, settings: true },
  });

  for (const { settings, ...company } of companies) {
    if (!settings) continue;
    const context: JobContext = { tenant: getTenantPrisma(company.id), company, settings, now };
    for (const job of jobs) {
      if (job.module && !isModuleEnabled(settings, job.module)) continue;
      await runJobForCompany(job, context);
    }
  }
}

/** For `/health`. `ok` is false if the worker hasn't ticked lately, or ever. */
export async function getWorkerStatus(now: Date): Promise<{ lastTickAt: string | null; ok: boolean }> {
  const heartbeat = await platformPrisma.jobRun.findFirst({ where: { ...HEARTBEAT, companyId: null }, select: { startedAt: true } });
  if (!heartbeat) return { lastTickAt: null, ok: false };
  return {
    lastTickAt: heartbeat.startedAt.toISOString(),
    ok: now.getTime() - heartbeat.startedAt.getTime() < WORKER_OK_WITHIN_MS,
  };
}
