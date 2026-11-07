import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { runTick } from "../../lib/jobs/runner.js";
import { platformPrisma } from "../../lib/prisma.js";
import { createTestCompany, createTestUser } from "../../test/helpers.js";
import { checkinReminderJob, getReminderAt, isReminderDue } from "./checkinReminder.job.js";

/**
 * The check-in reminder with a fake clock. 2026-03-03 is a Tuesday. Colombo is UTC+5:30,
 * so the default 09:00 start is 03:30 UTC.
 */
const TUESDAY = "2026-03-03";
const AT_START = "2026-03-03T03:30:00.000Z";
const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const tick = (iso: string) => runTick([checkinReminderJob], new Date(iso));

async function setUp(opts: { settings?: Record<string, unknown>; modules?: Record<string, boolean> } = {}) {
  const company = await createTestCompany();
  await platformPrisma.companySettings.update({
    where: { companyId: company.id },
    data: { enabledModules: opts.modules ?? { attendance: true, sites: true }, attendanceEnabledAt: new Date("2020-01-01T00:00:00.000Z"), ...opts.settings },
  });
  return company;
}

async function addEmployee(companyId: string, code = "EMP-001", opts: { status?: "ACTIVE" | "DEACTIVATED" } = {}) {
  const { employeeId, user } = await createTestUser({ companyId, role: "EMPLOYEE", employeeCode: code, status: opts.status });
  return { employeeId: employeeId!, userId: user.id };
}

function remindersOf(userId: string) {
  return platformPrisma.notification.findMany({ where: { userId, type: "CHECKIN_REMINDER" } });
}

describe("getReminderAt / isReminderDue", () => {
  const start = new Date(AT_START);

  it("is the shift start plus the offset, and none on a day with no shift", () => {
    expect(getReminderAt({ scheduledStartAt: start }, 30)).toEqual(new Date("2026-03-03T04:00:00.000Z"));
    expect(getReminderAt({ scheduledStartAt: null }, 30)).toBeNull();
  });

  it("is due from the reminder time for 2 hours", () => {
    expect(isReminderDue(start, new Date("2026-03-03T03:29:59.000Z"))).toBe(false);
    expect(isReminderDue(start, start)).toBe(true);
    expect(isReminderDue(start, new Date("2026-03-03T05:29:59.000Z"))).toBe(true);
    expect(isReminderDue(start, new Date("2026-03-03T05:30:00.000Z"))).toBe(false);
    expect(isReminderDue(null, start)).toBe(false);
  });
});

describe("attendance.checkinReminder", () => {
  it("reminds at the shift start, once however many ticks follow", async () => {
    const company = await setUp();
    const { userId } = await addEmployee(company.id);

    await tick("2026-03-03T03:29:59.000Z");
    expect(await remindersOf(userId)).toHaveLength(0);

    await tick(AT_START);
    await tick("2026-03-03T03:30:30.000Z");
    await tick("2026-03-03T05:00:00.000Z");

    const rows = await remindersOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "You haven't checked in yet",
      body: "Your shift started at 09:00. Remember to check in when you arrive.",
      relatedEntityType: null,
      relatedEntityId: null,
      dedupeKey: expect.stringMatching(new RegExp(`:${TUESDAY}$`)),
    });
    // No claim rows: it's per employee, with only the dedupeKey (§5.4).
    expect(await platformPrisma.jobRun.count({ where: { jobName: "attendance.checkinReminder" } })).toBe(0);
  });

  it("isn't sent once it's 2 hours late", async () => {
    const company = await setUp();
    const { userId } = await addEmployee(company.id);

    await tick("2026-03-03T05:30:00.000Z");

    expect(await remindersOf(userId)).toHaveLength(0);
  });

  it("waits for the offset", async () => {
    const company = await setUp({ settings: { checkinReminderOffsetMinutes: 30 } });
    const { userId } = await addEmployee(company.id);

    await tick(AT_START);
    expect(await remindersOf(userId)).toHaveLength(0);
    await tick("2026-03-03T04:00:00.000Z");
    expect(await remindersOf(userId)).toHaveLength(1);
  });

  it("skips anyone with a record or a site visit that day", async () => {
    const company = await setUp();
    const checkedIn = await addEmployee(company.id, "EMP-001");
    const onSite = await addEmployee(company.id, "EMP-002");
    const nobody = await addEmployee(company.id, "EMP-003");
    await platformPrisma.attendanceRecord.create({
      data: { companyId: company.id, employeeId: checkedIn.employeeId, workDate: date(TUESDAY), status: "PRESENT", checkInAt: new Date("2026-03-03T03:20:00.000Z"), source: "MOBILE" },
    });
    const { user: hr } = await createTestUser({ companyId: company.id, role: "HR", email: `hr-${crypto.randomBytes(3).toString("hex")}@example.test` });
    const site = await platformPrisma.site.create({
      data: { companyId: company.id, name: "Client", type: "EXTERNAL", radiusMeters: 200, gpsRequired: false, createdByUserId: hr.id },
    });
    // A visit with no record, as with the attendance module off when it was made.
    await platformPrisma.siteVisit.create({
      data: { companyId: company.id, employeeId: onSite.employeeId, siteId: site.id, workDate: date(TUESDAY), checkInAt: new Date("2026-03-03T03:25:00.000Z"), clientRequestId: crypto.randomUUID() },
    });

    await tick(AT_START);

    expect(await remindersOf(checkedIn.userId)).toHaveLength(0);
    expect(await remindersOf(onSite.userId)).toHaveLength(0);
    expect(await remindersOf(nobody.userId)).toHaveLength(1);
  });

  it("skips full-day approved leave, but not half-day leave (which half isn't recorded) or pending leave", async () => {
    const company = await setUp();
    const leaveType = await platformPrisma.leaveType.findFirstOrThrow({ where: { companyId: company.id, code: "ANNUAL" } });
    const full = await addEmployee(company.id, "EMP-001");
    const half = await addEmployee(company.id, "EMP-002");
    const pending = await addEmployee(company.id, "EMP-003");
    const leave = (employeeId: string, overrides: Record<string, unknown> = {}) =>
      platformPrisma.leaveRequest.create({
        data: { companyId: company.id, employeeId, leaveTypeId: leaveType.id, startDate: date("2026-03-02"), endDate: date(TUESDAY), totalDays: 2, status: "APPROVED", ...overrides },
      });
    await leave(full.employeeId);
    await leave(half.employeeId, { endHalfDay: true, totalDays: 1.5 });
    await leave(pending.employeeId, { status: "PENDING_MANAGER" });

    await tick(AT_START);

    expect(await remindersOf(full.userId)).toHaveLength(0);
    expect(await remindersOf(half.userId)).toHaveLength(1);
    expect(await remindersOf(pending.userId)).toHaveLength(1);
  });

  it("sends nothing on a holiday or a weekly off day", async () => {
    const company = await setUp();
    const { userId } = await addEmployee(company.id);
    await platformPrisma.companyHoliday.create({ data: { companyId: company.id, date: date(TUESDAY), name: "Poya" } });

    await tick(AT_START);
    // Sunday 8 Mar is OFF by default.
    await tick("2026-03-08T03:30:00.000Z");

    expect(await remindersOf(userId)).toHaveLength(0);
  });

  it("skips no active login, someone who has left, and someone who hasn't joined yet", async () => {
    const company = await setUp();
    const deactivated = await addEmployee(company.id, "EMP-001", { status: "DEACTIVATED" });
    const left = await addEmployee(company.id, "EMP-002");
    await platformPrisma.employee.update({ where: { id: left.employeeId }, data: { status: "INACTIVE" } });
    const joiner = await addEmployee(company.id, "EMP-003");
    await platformPrisma.employee.update({ where: { id: joiner.employeeId }, data: { joiningDate: date("2026-03-04") } });
    await platformPrisma.employee.create({
      data: { companyId: company.id, employeeCode: "EMP-004", firstName: "No", lastName: "Login", joiningDate: date("2024-01-01") },
    });

    await tick(AT_START);

    expect(await platformPrisma.notification.count({ where: { type: "CHECKIN_REMINDER" } })).toBe(0);
  });

  describe("an override", () => {
    it("a night shift is reminded at its own start, and the company's hours at theirs", async () => {
      const company = await setUp();
      const day = await addEmployee(company.id, "EMP-001");
      const night = await addEmployee(company.id, "EMP-002");
      await platformPrisma.employeeSchedule.create({ data: { companyId: company.id, employeeId: night.employeeId, startTime: "22:00", endTime: "06:00" } });

      await tick(AT_START);
      expect(await remindersOf(day.userId)).toHaveLength(1);
      expect(await remindersOf(night.userId)).toHaveLength(0);

      // 22:00 Colombo is 16:30 UTC.
      await tick("2026-03-03T16:30:00.000Z");
      const rows = await remindersOf(night.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.body).toContain("22:00");
    });

    it("a reminder that falls after midnight still counts for the day the shift started", async () => {
      const company = await setUp({ settings: { checkinReminderOffsetMinutes: 60 } });
      const night = await addEmployee(company.id);
      await platformPrisma.employeeSchedule.create({ data: { companyId: company.id, employeeId: night.employeeId, startTime: "23:30", endTime: "07:30" } });

      // 00:30 on Wednesday in Colombo is 19:00 UTC on Tuesday.
      await tick("2026-03-03T19:00:00.000Z");

      const rows = await remindersOf(night.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.dedupeKey).toBe(`CHECKIN_REMINDER:${night.employeeId}:${TUESDAY}`);
    });
  });

  it("sends nothing with the switch off, or the attendance module off", async () => {
    const off = await setUp({ settings: { checkinReminderEnabled: false } });
    const noModule = await setUp({ modules: { sites: true } });
    await addEmployee(off.id);
    await addEmployee(noModule.id);

    await tick(AT_START);

    expect(await platformPrisma.notification.count()).toBe(0);
  });

  it("two workers at once: one reminder", async () => {
    const company = await setUp();
    const { userId } = await addEmployee(company.id);

    await Promise.all([tick(AT_START), tick(AT_START)]);

    expect(await remindersOf(userId)).toHaveLength(1);
  });

  it("cross-tenant: a company's reminder stays in that company, and one company's switch doesn't affect another", async () => {
    const a = await setUp();
    const b = await setUp({ settings: { checkinReminderEnabled: false } });
    const inA = await addEmployee(a.id);
    const inB = await addEmployee(b.id);

    await tick(AT_START);

    expect((await remindersOf(inA.userId)).map((row) => row.companyId)).toEqual([a.id]);
    expect(await remindersOf(inB.userId)).toHaveLength(0);
  });
});
