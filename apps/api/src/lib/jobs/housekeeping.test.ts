import { describe, expect, it } from "vitest";
import { platformPrisma } from "../prisma.js";
import { createTestCompany } from "../../test/helpers.js";
import { housekeepingJob } from "./housekeeping.js";
import { getWorkerStatus, runTick } from "./runner.js";

const AT_FOUR_UTC = "2026-11-03T04:00:00.000Z";
const NOW = new Date(AT_FOUR_UTC);
const daysAgo = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * 86_400_000 + extraMs);
const tick = (iso = AT_FOUR_UTC) => runTick([], new Date(iso), [housekeepingJob]);

describe("housekeeping", () => {
  it("deletes job_runs older than 30 days, keeps newer ones, and never the heartbeat", async () => {
    const company = await createTestCompany();
    // The heartbeat is written by each tick, so make it old first: only its startedAt moves.
    await runTick([], daysAgo(40));
    await platformPrisma.jobRun.createMany({
      data: [
        { jobName: "attendance.dayClose", companyId: company.id, runKey: "old", status: "DONE", startedAt: daysAgo(30, -1) },
        { jobName: "leave.proofOverdue", companyId: company.id, runKey: "old-failed", status: "FAILED", startedAt: daysAgo(45) },
        { jobName: "attendance.dayClose", companyId: company.id, runKey: "recent", status: "DONE", startedAt: daysAgo(30, 60_000) },
      ],
    });

    await tick();

    const keys = (await platformPrisma.jobRun.findMany({ select: { jobName: true, runKey: true } })).map((row) => `${row.jobName}:${row.runKey}`);
    expect(keys.sort()).toEqual(["attendance.dayClose:recent", "housekeeping:2026-11-03", "worker.tick:heartbeat"]);
    expect(await getWorkerStatus(NOW)).toMatchObject({ ok: true });
  });

  it("runs once per UTC date from 04:00, as a platform-wide claim, catching up on a missed day", async () => {
    // Just before 04:00: yesterday's run was missed, so it catches up.
    await tick("2026-11-03T03:59:00.000Z");
    await tick();
    await tick("2026-11-03T12:00:00.000Z");
    await tick("2026-11-04T03:59:00.000Z");

    const runs = await platformPrisma.jobRun.findMany({ where: { jobName: "housekeeping" }, orderBy: { runKey: "asc" } });
    expect(runs.map((run) => [run.companyId, run.runKey, run.status])).toEqual([
      [null, "2026-11-02", "DONE"],
      [null, "2026-11-03", "DONE"],
    ]);
  });
});
