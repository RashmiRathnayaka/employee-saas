import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { runTick } from "../../lib/jobs/runner.js";
import { platformPrisma } from "../../lib/prisma.js";
import { createTestCompany, createTestUser } from "../../test/helpers.js";
import { gpsPurgeJob } from "./gpsPurge.job.js";

/**
 * The GPS purge with a fake clock. It runs at 03:00 Colombo, which is 21:30 UTC the day
 * before. The default retention is 90 days.
 */
const PURGE_AT = "2026-06-09T21:30:00.000Z"; // 03:00 on 10 Jun 2026 in Colombo
const NOW = new Date(PURGE_AT);
const daysAgo = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * 86_400_000 + extraMs);
const tick = (iso = PURGE_AT) => runTick([gpsPurgeJob], new Date(iso));

const POSITION = { checkInLat: 6.9271, checkInLng: 79.8612, checkOutLat: 6.9272, checkOutLng: 79.8613 };
/** Everything about a position that's kept: the employment record (§3.5). */
const KEPT = {
  checkInAccuracyM: 12,
  checkInDistanceM: 40,
  checkInWithinRadius: true,
  checkInMocked: false,
  checkOutAccuracyM: 15,
  checkOutDistanceM: 55,
  checkOutWithinRadius: true,
  checkOutMocked: false,
};

async function setUp(opts: { status?: "ACTIVE" | "SUSPENDED"; settings?: Record<string, unknown> } = {}) {
  const company = await createTestCompany({ status: opts.status });
  if (opts.settings) await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: opts.settings });
  const { employeeId, user } = await createTestUser({ companyId: company.id, role: "HR", employeeCode: "EMP-001" });
  const site = await platformPrisma.site.create({
    data: { companyId: company.id, name: "Client", type: "EXTERNAL", radiusMeters: 200, gpsRequired: false, createdByUserId: user.id },
  });
  let day = 0;

  async function addRecord(checkInAt: Date, overrides: Record<string, unknown> = {}) {
    day += 1;
    return platformPrisma.attendanceRecord.create({
      data: {
        companyId: company.id,
        employeeId: employeeId!,
        workDate: new Date(Date.UTC(2025, 0, day)),
        status: "PRESENT",
        checkInAt,
        checkOutAt: new Date(checkInAt.getTime() + 8 * 3_600_000),
        workedMinutes: 480,
        flags: ["OUTSIDE_RADIUS"],
        source: "MOBILE",
        ...POSITION,
        ...KEPT,
        ...overrides,
      },
    });
  }

  async function addVisit(checkInAt: Date) {
    return platformPrisma.siteVisit.create({
      data: {
        companyId: company.id,
        employeeId: employeeId!,
        siteId: site.id,
        workDate: new Date(Date.UTC(2025, 0, 1)),
        status: "CLOSED",
        checkInAt,
        checkOutAt: new Date(checkInAt.getTime() + 3_600_000),
        durationMinutes: 60,
        clientRequestId: crypto.randomUUID(),
        ...POSITION,
        ...KEPT,
      },
    });
  }
  return { company, addRecord, addVisit };
}

const coordinates = (row: Record<string, unknown>) => ({
  checkInLat: row.checkInLat === null ? null : Number(row.checkInLat),
  checkInLng: row.checkInLng === null ? null : Number(row.checkInLng),
  checkOutLat: row.checkOutLat === null ? null : Number(row.checkOutLat),
  checkOutLng: row.checkOutLng === null ? null : Number(row.checkOutLng),
});
const NONE = { checkInLat: null, checkInLng: null, checkOutLat: null, checkOutLng: null };
/** Every column except the four coordinates and updatedAt. */
const withoutCoordinates = ({ checkInLat, checkInLng, checkOutLat, checkOutLng, updatedAt, ...rest }: Record<string, unknown>) => rest;

describe("gps.purge", () => {
  it("clears only the coordinates older than the retention, and deletes no rows", async () => {
    const { addRecord, addVisit } = await setUp();
    const oldRecord = await addRecord(daysAgo(90, -1));
    const keptRecord = await addRecord(daysAgo(90, 60_000));
    const oldVisit = await addVisit(daysAgo(200));
    const keptVisit = await addVisit(daysAgo(10));
    const counts = async () => [await platformPrisma.attendanceRecord.count(), await platformPrisma.siteVisit.count()];
    const before = await counts();

    await tick();

    expect(await counts()).toEqual(before);
    const record = await platformPrisma.attendanceRecord.findUniqueOrThrow({ where: { id: oldRecord.id } });
    const visit = await platformPrisma.siteVisit.findUniqueOrThrow({ where: { id: oldVisit.id } });
    expect(coordinates(record)).toEqual(NONE);
    expect(coordinates(visit)).toEqual(NONE);
    // Distance, within-radius, accuracy, mocked, flags, times and status are all untouched.
    expect(withoutCoordinates(record)).toEqual(withoutCoordinates(oldRecord));
    expect(withoutCoordinates(visit)).toEqual(withoutCoordinates(oldVisit));
    expect(record).toMatchObject(KEPT);

    expect(coordinates(await platformPrisma.attendanceRecord.findUniqueOrThrow({ where: { id: keptRecord.id } }))).toEqual(POSITION);
    expect(coordinates(await platformPrisma.siteVisit.findUniqueOrThrow({ where: { id: keptVisit.id } }))).toEqual(POSITION);
  });

  it("also clears a check-out position when the check-in had none", async () => {
    const { addRecord } = await setUp();
    const row = await addRecord(daysAgo(100), { checkInLat: null, checkInLng: null });

    await tick();

    expect(coordinates(await platformPrisma.attendanceRecord.findUniqueOrThrow({ where: { id: row.id } }))).toEqual(NONE);
  });

  it("uses each company's own retention, and touches only that company's rows", async () => {
    const short = await setUp({ settings: { gpsRetentionDays: 30 } });
    const long = await setUp({ settings: { gpsRetentionDays: 365 } });
    const shortRow = await short.addRecord(daysAgo(31));
    const longRow = await long.addRecord(daysAgo(31));

    await tick();

    expect(coordinates(await platformPrisma.attendanceRecord.findUniqueOrThrow({ where: { id: shortRow.id } }))).toEqual(NONE);
    expect(coordinates(await platformPrisma.attendanceRecord.findUniqueOrThrow({ where: { id: longRow.id } }))).toEqual(POSITION);
  });

  it("runs once per date from 03:00 company time, catching up on a missed day", async () => {
    const { company } = await setUp();

    // A minute before 03:00: yesterday's run was missed (no worker), so it catches up.
    await tick("2026-06-09T21:29:00.000Z");
    await tick();
    await tick("2026-06-09T22:00:00.000Z");
    await tick("2026-06-10T21:29:00.000Z");

    const runs = await platformPrisma.jobRun.findMany({ where: { jobName: "gps.purge" }, orderBy: { runKey: "asc" } });
    expect(runs.map((run) => [run.companyId, run.runKey, run.status])).toEqual([
      [company.id, "2026-06-09", "DONE"],
      [company.id, "2026-06-10", "DONE"],
    ]);
  });

  it("runs for a suspended company, and with the attendance and sites modules off", async () => {
    const { addRecord } = await setUp({ status: "SUSPENDED", settings: { enabledModules: {} } });
    const row = await addRecord(daysAgo(100));

    await tick();

    expect(coordinates(await platformPrisma.attendanceRecord.findUniqueOrThrow({ where: { id: row.id } }))).toEqual(NONE);
  });
});
