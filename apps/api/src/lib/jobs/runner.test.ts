import { describe, expect, it, vi } from "vitest";
import { platformPrisma } from "../prisma.js";
import { createTestCompany } from "../../test/helpers.js";
import { claimRun, getWorkerStatus, runTick, sanitiseError, type Job, type PlatformJob } from "./runner.js";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const minutesLater = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const PLATFORM_RUN = { jobName: "test.job", companyId: null, runKey: "k1" };

function runRows(jobName = "test.job") {
  return platformPrisma.jobRun.findMany({ where: { jobName } });
}

describe("claimRun", () => {
  it("only the first caller gets a run", async () => {
    expect(await claimRun(PLATFORM_RUN, NOW)).toBe(true);
    expect(await claimRun(PLATFORM_RUN, NOW)).toBe(false);
    expect(await runRows()).toHaveLength(1);
  });

  it("two simultaneous callers: exactly one gets it", async () => {
    const results = await Promise.all([claimRun(PLATFORM_RUN, NOW), claimRun(PLATFORM_RUN, NOW)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("treats a null companyId as a value, so a platform-wide job can't run twice", async () => {
    await claimRun(PLATFORM_RUN, NOW);
    await expect(platformPrisma.jobRun.create({ data: { ...PLATFORM_RUN, startedAt: NOW } })).rejects.toThrow();
  });

  it("keeps companies and run keys apart", async () => {
    const company = await createTestCompany();
    await claimRun(PLATFORM_RUN, NOW);
    expect(await claimRun({ ...PLATFORM_RUN, companyId: company.id }, NOW)).toBe(true);
    expect(await claimRun({ ...PLATFORM_RUN, runKey: "k2" }, NOW)).toBe(true);
  });

  describe("a RUNNING row whose worker died", () => {
    it("can't be taken at 15 minutes, can just after, and counts the attempt", async () => {
      await claimRun(PLATFORM_RUN, NOW);
      expect(await claimRun(PLATFORM_RUN, minutesLater(15))).toBe(false);
      expect(await claimRun(PLATFORM_RUN, minutesLater(15.01))).toBe(true);
      const [row] = await runRows();
      expect(row).toMatchObject({ status: "RUNNING", attempts: 2, startedAt: minutesLater(15.01) });
    });

    it("two workers recovering it at once: exactly one gets it", async () => {
      await claimRun(PLATFORM_RUN, NOW);
      const later = minutesLater(20);
      const results = await Promise.all([claimRun(PLATFORM_RUN, later), claimRun(PLATFORM_RUN, later)]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("gives up after 3 attempts", async () => {
      await claimRun(PLATFORM_RUN, NOW);
      expect(await claimRun(PLATFORM_RUN, minutesLater(20))).toBe(true);
      expect(await claimRun(PLATFORM_RUN, minutesLater(40))).toBe(true);
      expect(await claimRun(PLATFORM_RUN, minutesLater(60))).toBe(false);
    });
  });

  it("never takes back a finished run", async () => {
    await claimRun(PLATFORM_RUN, NOW);
    await platformPrisma.jobRun.updateMany({ data: { status: "DONE" } });
    expect(await claimRun(PLATFORM_RUN, minutesLater(600))).toBe(false);
  });
});

describe("runTick", () => {
  function job(overrides: Partial<Job> = {}): Job {
    return {
      name: "test.job",
      dueRunKeys: async () => ["k1"],
      run: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it("runs a due key once per company across ticks, and marks it DONE", async () => {
    const a = await createTestCompany();
    const b = await createTestCompany();
    const testJob = job();

    await runTick([testJob], NOW);
    await runTick([testJob], minutesLater(1));

    expect(testJob.run).toHaveBeenCalledTimes(2);
    const rows = await runRows();
    expect(rows.map((row) => row.companyId).sort()).toEqual([a.id, b.id].sort());
    expect(rows.every((row) => row.status === "DONE" && row.finishedAt !== null)).toBe(true);
  });

  it("passes the fake clock and the company's own tenant client to the job", async () => {
    const company = await createTestCompany();
    const everyTick = vi.fn(async () => undefined);

    await runTick([job({ everyTick })], NOW);

    expect(everyTick).toHaveBeenCalledWith(expect.objectContaining({ now: NOW, company: expect.objectContaining({ id: company.id }) }));
  });

  it("two workers on the same tick: the key runs once", async () => {
    await createTestCompany();
    const testJob = job();

    await Promise.all([runTick([testJob], NOW), runTick([testJob], NOW)]);

    expect(testJob.run).toHaveBeenCalledTimes(1);
    expect(await runRows()).toHaveLength(1);
  });

  it("skips a company with the job's module off (a missing key means off)", async () => {
    const off = await createTestCompany();
    const on = await createTestCompany();
    await platformPrisma.companySettings.update({ where: { companyId: on.id }, data: { enabledModules: { attendance: true } } });
    const everyTick = vi.fn(async () => undefined);

    await runTick([job({ module: "attendance", everyTick })], NOW);

    const seen = everyTick.mock.calls.map((call) => (call as unknown as [{ company: { id: string } }])[0].company.id);
    expect(seen).toEqual([on.id]);
    expect(seen).not.toContain(off.id);
  });

  it("skips a suspended company", async () => {
    await createTestCompany({ status: "SUSPENDED" });
    const testJob = job();

    await runTick([testJob], NOW);

    expect(testJob.run).not.toHaveBeenCalled();
  });

  it("runs a job marked runsWhileSuspended for a suspended company, and only that job", async () => {
    const suspended = await createTestCompany({ status: "SUSPENDED" });
    const active = await createTestCompany();
    const purge = job({ name: "test.purge", runsWhileSuspended: true });
    const reminder = job({ name: "test.reminder" });

    await runTick([purge, reminder], NOW);

    expect((await runRows("test.purge")).map((row) => row.companyId).sort()).toEqual([suspended.id, active.id].sort());
    expect((await runRows("test.reminder")).map((row) => row.companyId)).toEqual([active.id]);
  });

  describe("platform-wide jobs", () => {
    function platformJob(overrides: Partial<PlatformJob> = {}): PlatformJob {
      return { name: "test.platform", dueRunKeys: () => ["2026-11-03"], run: vi.fn(async () => undefined), ...overrides };
    }

    it("run once per key, with no company, even with no companies at all", async () => {
      const testJob = platformJob();

      await runTick([], NOW, [testJob]);
      await runTick([], minutesLater(1), [testJob]);

      expect(testJob.run).toHaveBeenCalledTimes(1);
      expect(testJob.run).toHaveBeenCalledWith(NOW, "2026-11-03");
      expect(await runRows("test.platform")).toMatchObject([{ companyId: null, status: "DONE" }]);
    });

    it("two workers on the same tick: it runs once", async () => {
      const testJob = platformJob();

      await Promise.all([runTick([], NOW, [testJob]), runTick([], NOW, [testJob])]);

      expect(testJob.run).toHaveBeenCalledTimes(1);
    });

    it("a failure is recorded and doesn't stop the companies' jobs", async () => {
      await createTestCompany();
      const failing = platformJob({ run: async () => Promise.reject(new Error("boom")) });
      const companyJob = job();

      await runTick([companyJob], NOW, [failing]);

      expect((await runRows("test.platform"))[0]).toMatchObject({ status: "FAILED", lastError: "Error: boom" });
      expect(companyJob.run).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a job throws", () => {
    it("marks the run FAILED, retries it on a later tick, and stops after 3 attempts", async () => {
      await createTestCompany();
      const testJob = job({ run: vi.fn(async () => Promise.reject(new Error("boom"))) });

      await runTick([testJob], NOW);
      expect((await runRows())[0]).toMatchObject({ status: "FAILED", attempts: 1, lastError: "Error: boom" });

      await runTick([testJob], minutesLater(1));
      await runTick([testJob], minutesLater(2));
      await runTick([testJob], minutesLater(3));

      expect(testJob.run).toHaveBeenCalledTimes(3);
      expect((await runRows())[0]).toMatchObject({ status: "FAILED", attempts: 3 });
    });

    it("a retry that works clears the error", async () => {
      await createTestCompany();
      const run = vi.fn<NonNullable<Job["run"]>>().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);

      await runTick([job({ run })], NOW);
      await runTick([job({ run })], minutesLater(1));

      expect((await runRows())[0]).toMatchObject({ status: "DONE", attempts: 2, lastError: null });
    });

    it("one company's failure doesn't stop another's jobs, or the next job", async () => {
      const a = await createTestCompany();
      const b = await createTestCompany();
      const failing = job({ name: "test.fails", everyTick: async () => Promise.reject(new Error("boom")) });
      const everyTick = vi.fn(async () => undefined);

      await runTick([failing, job({ name: "test.after", everyTick })], NOW);

      const seen = everyTick.mock.calls.map((call) => (call as unknown as [{ company: { id: string } }])[0].company.id);
      expect(seen.sort()).toEqual([a.id, b.id].sort());
    });
  });
});

describe("sanitiseError", () => {
  it("keeps a code and the first line, cut short", () => {
    const err = Object.assign(new Error(`bad thing\nsecond line`), { code: "E_BAD" });
    expect(sanitiseError(err)).toBe("E_BAD: bad thing");
    expect(sanitiseError(new Error("x".repeat(500))).length).toBe(200);
  });

  it("keeps only the code of a Prisma error, whose message can quote row data", () => {
    const err = Object.assign(new Error("Invalid invocation, email: secret@example.test"), { name: "PrismaClientKnownRequestError", code: "P2002" });
    expect(sanitiseError(err)).toBe("P2002");
  });

  it("copes with something that isn't an Error", () => {
    expect(sanitiseError("oops")).toBe("UNKNOWN_ERROR");
  });
});

describe("getWorkerStatus", () => {
  it("says so when no worker has ever ticked", async () => {
    expect(await getWorkerStatus(NOW)).toEqual({ lastTickAt: null, ok: false });
  });

  it("is ok under 2 minutes after a tick, and not at 2 minutes", async () => {
    await runTick([], NOW);
    expect(await getWorkerStatus(minutesLater(1.9))).toEqual({ lastTickAt: NOW.toISOString(), ok: true });
    expect((await getWorkerStatus(minutesLater(2))).ok).toBe(false);
  });

  it("each tick moves the same row along, so the heartbeat doesn't grow", async () => {
    await Promise.all([runTick([], NOW), runTick([], NOW)]);
    await runTick([], minutesLater(1));
    expect(await runRows("worker.tick")).toHaveLength(1);
    expect((await getWorkerStatus(minutesLater(1))).lastTickAt).toBe(minutesLater(1).toISOString());
  });
});
