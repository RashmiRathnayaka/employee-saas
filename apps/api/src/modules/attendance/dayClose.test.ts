import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { JOBS } from "../../jobs.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { runTick } from "../../lib/jobs/runner.js";
import { platformPrisma } from "../../lib/prisma.js";
import { createTestCompany, createTestUser } from "../../test/helpers.js";
import { listAllRecords } from "./attendanceAdmin.service.js";
import { dayCloseJob } from "./dayClose.job.js";

/**
 * Day close with a fake clock: nothing here depends on today's date, and rows are made
 * directly since a real check-in uses the real clock.
 *
 * 2026-03-03 is a Tuesday. Colombo is UTC+5:30. With the default 09:00-17:00 and 240
 * minutes of auto-checkout, that day's close time is 21:00 local, or 15:30 UTC.
 */
const TUESDAY = "2026-03-03";
const TUESDAY_START = new Date("2026-03-03T03:30:00.000Z");
const TUESDAY_END = new Date("2026-03-03T11:30:00.000Z");
const TUESDAY_CLOSE = "2026-03-03T15:30:00.000Z";
const JUST_BEFORE_CLOSE = "2026-03-03T15:29:59.000Z";

function date(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function tick(iso: string) {
  return runTick(JOBS, new Date(iso));
}

async function setUpCompany(opts: { modules?: Record<string, boolean>; timezone?: string } = {}) {
  const company = await createTestCompany();
  await platformPrisma.companySettings.update({
    where: { companyId: company.id },
    data: { enabledModules: opts.modules ?? { attendance: true, sites: true }, attendanceEnabledAt: new Date("2020-01-01T00:00:00.000Z") },
  });
  if (opts.timezone) await platformPrisma.company.update({ where: { id: company.id }, data: { timezone: opts.timezone } });
  return company;
}

async function addEmployee(companyId: string, code = "EMP-001", opts: { login?: boolean; loginStatus?: "ACTIVE" | "DEACTIVATED" } = {}) {
  if (opts.login === false) {
    const employee = await platformPrisma.employee.create({
      data: { companyId, employeeCode: code, firstName: "No", lastName: "Login", joiningDate: new Date("2024-01-01") },
    });
    return { employeeId: employee.id, userId: null };
  }
  const { employeeId, user } = await createTestUser({ companyId, role: "EMPLOYEE", employeeCode: code, status: opts.loginStatus });
  return { employeeId: employeeId!, userId: user.id };
}

function openRecord(companyId: string, employeeId: string, overrides: Record<string, unknown> = {}) {
  return platformPrisma.attendanceRecord.create({
    data: {
      companyId,
      employeeId,
      workDate: date(TUESDAY),
      status: "LATE",
      lateMinutes: 20,
      scheduledStartAt: TUESDAY_START,
      scheduledEndAt: TUESDAY_END,
      checkInAt: new Date("2026-03-03T03:50:00.000Z"),
      source: "MOBILE",
      ...overrides,
    },
  });
}

async function addSite(companyId: string) {
  const { user } = await createTestUser({ companyId, role: "HR", email: `hr-${crypto.randomBytes(3).toString("hex")}@example.test` });
  return platformPrisma.site.create({
    data: { companyId, name: `Site ${crypto.randomBytes(3).toString("hex")}`, type: "EXTERNAL", radiusMeters: 200, gpsRequired: false, createdByUserId: user.id },
  });
}

function addVisit(companyId: string, employeeId: string, siteId: string, overrides: Record<string, unknown> = {}) {
  return platformPrisma.siteVisit.create({
    data: {
      companyId,
      employeeId,
      siteId,
      workDate: date(TUESDAY),
      status: "OPEN",
      checkInAt: new Date("2026-03-03T06:00:00.000Z"),
      clientRequestId: crypto.randomUUID(),
      ...overrides,
    },
  });
}

function rowOf(companyId: string, employeeId: string, workDate = TUESDAY) {
  return platformPrisma.attendanceRecord.findFirst({ where: { companyId, employeeId, workDate: date(workDate) } });
}

function notificationsOf(userId: string) {
  return platformPrisma.notification.findMany({ where: { userId } });
}

describe("auto-close", () => {
  let company: Awaited<ReturnType<typeof setUpCompany>>;
  beforeEach(async () => {
    company = await setUpCompany();
  });

  it("leaves a record open until its close time, then closes it as INCOMPLETE", async () => {
    const { employeeId } = await addEmployee(company.id);
    const record = await openRecord(company.id, employeeId);

    await tick(JUST_BEFORE_CLOSE);
    expect(await platformPrisma.attendanceRecord.findUnique({ where: { id: record.id } })).toMatchObject({ status: "LATE", autoClosedAt: null });

    await tick(TUESDAY_CLOSE);
    expect(await platformPrisma.attendanceRecord.findUnique({ where: { id: record.id } })).toMatchObject({
      status: "INCOMPLETE",
      autoClosedAt: new Date(TUESDAY_CLOSE),
      flags: ["AUTO_CLOSED"],
      // §1.4: the lateness stays, and nobody knows when they left.
      lateMinutes: 20,
      workedMinutes: null,
      checkOutAt: null,
    });
  });

  it("tells the employee once, however many ticks run", async () => {
    const { employeeId, userId } = await addEmployee(company.id);
    const record = await openRecord(company.id, employeeId);

    await tick(TUESDAY_CLOSE);
    await tick("2026-03-03T15:31:00.000Z");

    const notifications = await notificationsOf(userId!);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "ATTENDANCE_AUTO_CLOSED",
      title: "You didn't check out",
      relatedEntityType: "AttendanceRecord",
      relatedEntityId: record.id,
      dedupeKey: `AUTO_CLOSED:${record.id}`,
    });
    expect(notifications[0]!.body).toContain("03 Mar 2026");
    expect(notifications[0]!.body).toContain("Ask HR");
  });

  it.each([
    ["no login", { login: false }],
    ["a deactivated login", { loginStatus: "DEACTIVATED" as const }],
  ])("closes the record of someone with %s, and tells nobody", async (_name, opts) => {
    const { employeeId } = await addEmployee(company.id, "EMP-001", opts);
    await openRecord(company.id, employeeId);

    await tick(TUESDAY_CLOSE);

    expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "INCOMPLETE" });
    expect(await platformPrisma.notification.count({ where: { companyId: company.id } })).toBe(0);
  });

  it("finds a check-in with no schedule (a holiday or weekly off): 16 hours after it", async () => {
    const { employeeId } = await addEmployee(company.id);
    const checkInAt = new Date("2026-03-08T04:00:00.000Z");
    await openRecord(company.id, employeeId, { workDate: date("2026-03-08"), status: "PRESENT", lateMinutes: 0, scheduledStartAt: null, scheduledEndAt: null, checkInAt, flags: ["NON_WORKING_DAY"] });

    await tick("2026-03-08T19:59:59.000Z");
    expect(await rowOf(company.id, employeeId, "2026-03-08")).toMatchObject({ status: "PRESENT" });

    await tick("2026-03-08T20:00:00.000Z");
    expect(await rowOf(company.id, employeeId, "2026-03-08")).toMatchObject({ status: "INCOMPLETE", flags: ["NON_WORKING_DAY", "AUTO_CLOSED"] });
  });

  it("doesn't cut a night shift in half at midnight", async () => {
    const { employeeId } = await addEmployee(company.id);
    await openRecord(company.id, employeeId, {
      status: "PRESENT",
      scheduledStartAt: new Date("2026-03-03T16:30:00.000Z"),
      scheduledEndAt: new Date("2026-03-04T00:30:00.000Z"),
      checkInAt: new Date("2026-03-03T16:30:00.000Z"),
    });

    await tick("2026-03-03T18:31:00.000Z"); // Just after midnight in Colombo.
    expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "PRESENT" });

    await tick("2026-03-04T04:30:00.000Z"); // 06:00 + 4 hours.
    expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "INCOMPLETE" });
  });

  it("uses the record's snapshot, so changing the hours afterwards doesn't move its close time", async () => {
    const { employeeId } = await addEmployee(company.id);
    await openRecord(company.id, employeeId);
    await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { workEndTime: "23:00" } });

    await tick(TUESDAY_CLOSE);

    expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "INCOMPLETE" });
  });

  it("uses the company's auto-checkout setting", async () => {
    await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { autoCheckoutAfterMinutes: 30 } });
    const { employeeId } = await addEmployee(company.id);
    await openRecord(company.id, employeeId);

    await tick("2026-03-03T11:59:59.000Z");
    expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "LATE" });
    await tick("2026-03-03T12:00:00.000Z");
    expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "INCOMPLETE" });
  });

  it("doesn't touch a checked-out record", async () => {
    const { employeeId, userId } = await addEmployee(company.id);
    await openRecord(company.id, employeeId, { checkOutAt: new Date("2026-03-03T11:30:00.000Z"), workedMinutes: 460 });

    await tick(TUESDAY_CLOSE);

    expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "LATE", autoClosedAt: null, flags: [] });
    expect(await notificationsOf(userId!)).toHaveLength(0);
  });

  it("closes an old forgotten record too, even outside the catch-up window", async () => {
    const { employeeId } = await addEmployee(company.id);
    await openRecord(company.id, employeeId);

    await tick("2026-03-20T00:00:00.000Z");

    expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "INCOMPLETE" });
  });

  it("a linked open visit closes with its record, and the one notification says so", async () => {
    const { employeeId, userId } = await addEmployee(company.id);
    const record = await openRecord(company.id, employeeId);
    const site = await addSite(company.id);
    const visit = await addVisit(company.id, employeeId, site.id, { attendanceRecordId: record.id });

    await tick(TUESDAY_CLOSE);

    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({
      status: "AUTO_CLOSED",
      checkOutAt: null,
      durationMinutes: null,
    });
    const notifications = await notificationsOf(userId!);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.body).toContain(`Your visit to ${site.name} was closed too.`);
  });

  it("after an outage, closing yesterday's record doesn't end the visit someone is on today", async () => {
    const { employeeId } = await addEmployee(company.id);
    await openRecord(company.id, employeeId);
    const today = await openRecord(company.id, employeeId, {
      workDate: date("2026-03-04"),
      scheduledStartAt: new Date("2026-03-04T03:30:00.000Z"),
      scheduledEndAt: new Date("2026-03-04T11:30:00.000Z"),
      checkInAt: new Date("2026-03-04T03:30:00.000Z"),
    });
    const site = await addSite(company.id);
    const visit = await addVisit(company.id, employeeId, site.id, {
      attendanceRecordId: today.id,
      workDate: date("2026-03-04"),
      checkInAt: new Date("2026-03-04T05:00:00.000Z"),
    });

    await tick("2026-03-04T06:00:00.000Z");

    expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "INCOMPLETE" });
    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ status: "OPEN" });
    expect(await platformPrisma.attendanceRecord.findUnique({ where: { id: today.id } })).toMatchObject({ autoClosedAt: null });
  });

  it("with `sites` off, a linked visit still closes with its record: nothing else could close it", async () => {
    const offCompany = await setUpCompany({ modules: { attendance: true } });
    const { employeeId } = await addEmployee(offCompany.id);
    const record = await openRecord(offCompany.id, employeeId);
    const site = await addSite(offCompany.id);
    const visit = await addVisit(offCompany.id, employeeId, site.id, { attendanceRecordId: record.id });

    await tick(TUESDAY_CLOSE);

    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ status: "AUTO_CLOSED" });
  });

  it("does nothing with `attendance` off (§0)", async () => {
    const offCompany = await setUpCompany({ modules: { sites: true } });
    const { employeeId } = await addEmployee(offCompany.id);
    await openRecord(offCompany.id, employeeId);

    await tick(TUESDAY_CLOSE);

    expect(await rowOf(offCompany.id, employeeId)).toMatchObject({ status: "LATE", autoClosedAt: null });
  });

  it("does nothing for a suspended company", async () => {
    const suspended = await setUpCompany();
    await platformPrisma.company.update({ where: { id: suspended.id }, data: { status: "SUSPENDED" } });
    const { employeeId } = await addEmployee(suspended.id);
    await openRecord(suspended.id, employeeId);

    await tick(TUESDAY_CLOSE);

    expect(await rowOf(suspended.id, employeeId)).toMatchObject({ status: "LATE" });
  });
});

describe("a forgotten visit's own rule", () => {
  const VISIT_START = new Date("2026-03-03T06:00:00.000Z");
  const SIXTEEN_HOURS_LATER = "2026-03-03T22:00:00.000Z";

  it("closes 16 hours after check-in, and tells the employee once", async () => {
    const company = await setUpCompany();
    const { employeeId, userId } = await addEmployee(company.id);
    const site = await addSite(company.id);
    const visit = await addVisit(company.id, employeeId, site.id, { checkInAt: VISIT_START });

    await tick("2026-03-03T21:59:59.000Z");
    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ status: "OPEN" });

    await tick(SIXTEEN_HOURS_LATER);
    await tick("2026-03-03T22:01:00.000Z");

    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ status: "AUTO_CLOSED", checkOutAt: null });
    const notifications = await notificationsOf(userId!);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ type: "SITE_VISIT_AUTO_CLOSED", relatedEntityType: "SiteVisit", relatedEntityId: visit.id });
    expect(notifications[0]!.body).toContain(site.name);
  });

  it("covers a visit after the day closed: its record is already checked out", async () => {
    const company = await setUpCompany();
    const { employeeId } = await addEmployee(company.id);
    const record = await openRecord(company.id, employeeId, { checkOutAt: new Date("2026-03-03T05:00:00.000Z") });
    const site = await addSite(company.id);
    const visit = await addVisit(company.id, employeeId, site.id, { attendanceRecordId: record.id, checkInAt: VISIT_START, flags: ["AFTER_HOURS"] });

    await tick(SIXTEEN_HOURS_LATER);

    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ status: "AUTO_CLOSED" });
  });

  it("works with `attendance` off, where there's no day close at all", async () => {
    const company = await setUpCompany({ modules: { sites: true } });
    const { employeeId } = await addEmployee(company.id);
    const site = await addSite(company.id);
    const visit = await addVisit(company.id, employeeId, site.id, { checkInAt: VISIT_START });

    await tick(SIXTEEN_HOURS_LATER);

    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ status: "AUTO_CLOSED" });
  });

  it("does nothing with `sites` off", async () => {
    const company = await setUpCompany({ modules: { attendance: true } });
    const { employeeId } = await addEmployee(company.id);
    const site = await addSite(company.id);
    const visit = await addVisit(company.id, employeeId, site.id, { checkInAt: VISIT_START });

    await tick(SIXTEEN_HOURS_LATER);

    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ status: "OPEN" });
  });

  it("leaves a closed visit alone", async () => {
    const company = await setUpCompany();
    const { employeeId } = await addEmployee(company.id);
    const site = await addSite(company.id);
    const visit = await addVisit(company.id, employeeId, site.id, { status: "CLOSED", checkOutAt: new Date("2026-03-03T07:00:00.000Z"), durationMinutes: 60 });

    await tick(SIXTEEN_HOURS_LATER);

    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ status: "CLOSED" });
  });
});

describe("absent marking", () => {
  let company: Awaited<ReturnType<typeof setUpCompany>>;
  beforeEach(async () => {
    company = await setUpCompany();
  });

  it("writes ABSENT at the close time, not before, with the schedule it was judged against", async () => {
    const { employeeId, userId } = await addEmployee(company.id);

    await tick(JUST_BEFORE_CLOSE);
    expect(await rowOf(company.id, employeeId)).toBeNull();

    await tick(TUESDAY_CLOSE);
    expect(await rowOf(company.id, employeeId)).toMatchObject({
      status: "ABSENT",
      source: "SYSTEM",
      checkInAt: null,
      flags: [],
      scheduledStartAt: TUESDAY_START,
      scheduledEndAt: TUESDAY_END,
    });
    // §5.4: no notification for absent.
    expect(await notificationsOf(userId!)).toHaveLength(0);
  });

  it("marks everyone in the company, and writes each row once however many ticks run", async () => {
    const one = await addEmployee(company.id, "EMP-001");
    const two = await addEmployee(company.id, "EMP-002");

    await tick(TUESDAY_CLOSE);
    await tick("2026-03-03T15:31:00.000Z");

    expect(await platformPrisma.attendanceRecord.count({ where: { workDate: date(TUESDAY), employeeId: { in: [one.employeeId, two.employeeId] } } })).toBe(2);
  });

  it("leaves a record that exists alone", async () => {
    const { employeeId } = await addEmployee(company.id);
    const record = await openRecord(company.id, employeeId, { checkOutAt: new Date("2026-03-03T11:30:00.000Z") });

    await tick(TUESDAY_CLOSE);

    expect(await rowOf(company.id, employeeId)).toMatchObject({ id: record.id, status: "LATE" });
  });

  it("writes nothing on a weekly off day", async () => {
    const { employeeId } = await addEmployee(company.id);

    await tick("2026-03-09T00:00:00.000Z"); // Sunday the 8th has ended in Colombo.

    expect(await rowOf(company.id, employeeId, "2026-03-08")).toBeNull();
  });

  it("marks a company half day from its half-day end", async () => {
    const { employeeId } = await addEmployee(company.id);

    await tick("2026-03-07T11:29:59.000Z");
    expect(await rowOf(company.id, employeeId, "2026-03-07")).toBeNull();

    await tick("2026-03-07T11:30:00.000Z");
    expect(await rowOf(company.id, employeeId, "2026-03-07")).toMatchObject({
      status: "ABSENT",
      scheduledEndAt: new Date("2026-03-07T07:30:00.000Z"),
    });
  });

  it("writes HOLIDAY once the day has ended, since anyone may check in until then", async () => {
    const { employeeId } = await addEmployee(company.id);
    await platformPrisma.companyHoliday.create({ data: { companyId: company.id, date: date(TUESDAY), name: "Poya" } });

    await tick("2026-03-03T18:29:59.000Z"); // 23:59:59 in Colombo.
    expect(await rowOf(company.id, employeeId)).toBeNull();

    await tick("2026-03-03T18:30:00.000Z");
    expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "HOLIDAY", scheduledStartAt: null, scheduledEndAt: null });
  });

  it("writes nothing for a holiday on a weekly off day", async () => {
    const { employeeId } = await addEmployee(company.id);
    await platformPrisma.companyHoliday.create({ data: { companyId: company.id, date: date("2026-03-08"), name: "Poya" } });

    await tick("2026-03-09T00:00:00.000Z");

    expect(await rowOf(company.id, employeeId, "2026-03-08")).toBeNull();
  });

  describe("approved leave", () => {
    async function addLeave(employeeId: string, overrides: Record<string, unknown> = {}) {
      const leaveType = await platformPrisma.leaveType.findFirstOrThrow({ where: { companyId: company.id } });
      return platformPrisma.leaveRequest.create({
        data: {
          companyId: company.id,
          employeeId,
          leaveTypeId: leaveType.id,
          startDate: date(TUESDAY),
          endDate: date(TUESDAY),
          totalDays: 1,
          status: "APPROVED",
          reason: "Test",
          ...overrides,
        },
      });
    }

    it("full day: ON_LEAVE", async () => {
      const { employeeId } = await addEmployee(company.id);
      await addLeave(employeeId);

      await tick(TUESDAY_CLOSE);

      expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "ON_LEAVE", flags: [] });
    });

    it("half day: ON_LEAVE with the flag (Q8)", async () => {
      const { employeeId } = await addEmployee(company.id);
      await addLeave(employeeId, { startHalfDay: true, totalDays: 0.5 });

      await tick(TUESDAY_CLOSE);

      expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "ON_LEAVE", flags: ["HALF_DAY_LEAVE"] });
    });

    it.each(["PENDING_MANAGER", "REJECTED", "CANCELLED", "REVOKED"])("%s leave doesn't count: ABSENT", async (status) => {
      const { employeeId } = await addEmployee(company.id);
      await addLeave(employeeId, { status });

      await tick(TUESDAY_CLOSE);

      expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "ABSENT" });
    });

    it("someone else's leave doesn't count", async () => {
      const onLeave = await addEmployee(company.id, "EMP-001");
      const here = await addEmployee(company.id, "EMP-002");
      await addLeave(onLeave.employeeId);

      await tick(TUESDAY_CLOSE);

      expect(await rowOf(company.id, here.employeeId)).toMatchObject({ status: "ABSENT" });
    });

    it("a holiday beats leave", async () => {
      const { employeeId } = await addEmployee(company.id);
      await addLeave(employeeId);
      await platformPrisma.companyHoliday.create({ data: { companyId: company.id, date: date(TUESDAY), name: "Poya" } });

      await tick("2026-03-03T18:30:00.000Z");

      expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "HOLIDAY" });
    });
  });

  describe("who counts", () => {
    it("not before their joining date, but from that date itself", async () => {
      const { employeeId } = await addEmployee(company.id);
      await platformPrisma.employee.update({ where: { id: employeeId }, data: { joiningDate: date("2026-03-04") } });

      await tick(TUESDAY_CLOSE);
      expect(await rowOf(company.id, employeeId)).toBeNull();

      await tick("2026-03-04T15:30:00.000Z");
      expect(await rowOf(company.id, employeeId, "2026-03-04")).toMatchObject({ status: "ABSENT" });
    });

    it("not someone who has left", async () => {
      const { employeeId } = await addEmployee(company.id);
      await platformPrisma.employee.update({ where: { id: employeeId }, data: { status: "INACTIVE" } });

      await tick(TUESDAY_CLOSE);

      expect(await rowOf(company.id, employeeId)).toBeNull();
    });

    it("someone with no login: an employee is still an employee", async () => {
      const { employeeId } = await addEmployee(company.id, "EMP-001", { login: false });

      await tick(TUESDAY_CLOSE);

      expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "ABSENT" });
    });
  });

  describe("when attendance was switched on", () => {
    const setEnabledAt = (attendanceEnabledAt: Date | null) =>
      platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { attendanceEnabledAt } });

    it("doesn't mark the days before it, even inside the catch-up window", async () => {
      const { employeeId } = await addEmployee(company.id);
      await setEnabledAt(new Date("2026-03-04T00:00:00.000Z"));

      await tick("2026-03-04T15:30:00.000Z");

      expect(await rowOf(company.id, employeeId)).toBeNull();
      expect(await rowOf(company.id, employeeId, "2026-03-04")).toMatchObject({ status: "ABSENT" });
    });

    it("doesn't mark the day it happened if the shift had already started", async () => {
      const { employeeId } = await addEmployee(company.id);
      await setEnabledAt(new Date(TUESDAY_START.getTime() + 1000));

      await tick(TUESDAY_CLOSE);

      expect(await rowOf(company.id, employeeId)).toBeNull();
    });

    it("marks nothing if it's never been recorded", async () => {
      const { employeeId } = await addEmployee(company.id);
      await setEnabledAt(null);

      await tick(TUESDAY_CLOSE);

      expect(await rowOf(company.id, employeeId)).toBeNull();
    });

    it("still auto-closes a record whatever it says: the record is real", async () => {
      const { employeeId } = await addEmployee(company.id);
      await openRecord(company.id, employeeId);
      await setEnabledAt(null);

      await tick(TUESDAY_CLOSE);

      expect(await rowOf(company.id, employeeId)).toMatchObject({ status: "INCOMPLETE" });
    });
  });

  it("does nothing with `attendance` off", async () => {
    const offCompany = await setUpCompany({ modules: { sites: true } });
    const { employeeId } = await addEmployee(offCompany.id);

    await tick(TUESDAY_CLOSE);

    expect(await rowOf(offCompany.id, employeeId)).toBeNull();
  });

  describe("night shifts and overrides", () => {
    const addOverride = (employeeId: string, overrides: Record<string, unknown> = {}) =>
      platformPrisma.employeeSchedule.create({ data: { companyId: company.id, employeeId, startTime: "22:00", endTime: "06:00", ...overrides } });

    it("each employee closes at their own time, and the date stays open until the last", async () => {
      const day = await addEmployee(company.id, "EMP-001");
      const night = await addEmployee(company.id, "EMP-002");
      await addOverride(night.employeeId);

      await tick(TUESDAY_CLOSE);
      expect(await rowOf(company.id, day.employeeId)).toMatchObject({ status: "ABSENT" });
      expect(await rowOf(company.id, night.employeeId)).toBeNull();
      expect(await platformPrisma.jobRun.count({ where: { companyId: company.id, jobName: "attendance.dayClose", runKey: TUESDAY } })).toBe(0);

      await tick("2026-03-04T04:29:59.000Z");
      expect(await rowOf(company.id, night.employeeId)).toBeNull();

      await tick("2026-03-04T04:30:00.000Z"); // 06:00 on the 4th + 4 hours.
      expect(await rowOf(company.id, night.employeeId)).toMatchObject({
        status: "ABSENT",
        scheduledStartAt: new Date("2026-03-03T16:30:00.000Z"),
        scheduledEndAt: new Date("2026-03-04T00:30:00.000Z"),
      });
      expect(await platformPrisma.jobRun.findFirst({ where: { companyId: company.id, jobName: "attendance.dayClose", runKey: TUESDAY } })).toMatchObject({ status: "DONE" });
    });

    it("an override's half day closes after the first half of its shift", async () => {
      const { employeeId } = await addEmployee(company.id);
      await addOverride(employeeId);

      await tick("2026-03-08T00:29:59.000Z"); // Saturday the 7th: 22:00-02:00, closing 06:00 on the 8th.
      expect(await rowOf(company.id, employeeId, "2026-03-07")).toBeNull();

      await tick("2026-03-08T00:30:00.000Z");
      expect(await rowOf(company.id, employeeId, "2026-03-07")).toMatchObject({ status: "ABSENT", scheduledEndAt: new Date("2026-03-07T20:30:00.000Z") });
    });

    it("an override's own week decides what's a working day", async () => {
      const { employeeId } = await addEmployee(company.id);
      await addOverride(employeeId, { startTime: "09:00", endTime: "17:00", workingDays: { mon: "OFF", tue: "OFF", wed: "FULL", thu: "FULL", fri: "FULL", sat: "OFF", sun: "FULL" } });

      await tick("2026-03-04T00:00:00.000Z");
      expect(await rowOf(company.id, employeeId)).toBeNull(); // Tuesday is off for them.

      await tick("2026-03-08T15:30:00.000Z");
      expect(await rowOf(company.id, employeeId, "2026-03-08")).toMatchObject({ status: "ABSENT" }); // Sunday isn't.
    });
  });

  describe("catching up after an outage", () => {
    it("marks the last two dates and today", async () => {
      const { employeeId } = await addEmployee(company.id);

      await tick("2026-03-05T16:00:00.000Z"); // Thursday evening, for the first time.

      for (const workDate of ["2026-03-03", "2026-03-04", "2026-03-05"]) {
        expect(await rowOf(company.id, employeeId, workDate)).toMatchObject({ status: "ABSENT" });
      }
      expect(await rowOf(company.id, employeeId, "2026-03-02")).toBeNull();
    });
  });

  it("stops scanning a finished date: its claim is DONE, so a row removed later isn't rewritten", async () => {
    const { employeeId } = await addEmployee(company.id);

    await tick(TUESDAY_CLOSE);
    await platformPrisma.attendanceRecord.deleteMany({ where: { employeeId } });
    await tick("2026-03-03T15:31:00.000Z");

    expect(await rowOf(company.id, employeeId)).toBeNull();
    expect(await platformPrisma.jobRun.findMany({ where: { companyId: company.id, jobName: "attendance.dayClose", runKey: TUESDAY } })).toMatchObject([{ status: "DONE", attempts: 1 }]);
  });

  it("uses the company's timezone: the same instant is a different date in New York", async () => {
    const newYork = await setUpCompany({ timezone: "America/New_York" });
    const { employeeId } = await addEmployee(newYork.id);

    await tick("2026-03-04T01:59:59.000Z"); // 20:59:59 on the 3rd, there.
    expect(await rowOf(newYork.id, employeeId)).toBeNull();

    await tick("2026-03-04T02:00:00.000Z");
    expect(await rowOf(newYork.id, employeeId)).toMatchObject({ status: "ABSENT" });
  });
});

describe("visits waiting for a row", () => {
  let company: Awaited<ReturnType<typeof setUpCompany>>;
  beforeEach(async () => {
    company = await setUpCompany();
  });

  it("on ABSENT: linked, and AFTER_HOURS becomes ON_ABSENT_DAY, keeping its GPS flags", async () => {
    const { employeeId } = await addEmployee(company.id);
    const site = await addSite(company.id);
    const visit = await addVisit(company.id, employeeId, site.id, { flags: ["AFTER_HOURS", "LOW_ACCURACY"] });

    await tick(TUESDAY_CLOSE);

    const row = await rowOf(company.id, employeeId);
    const updated = await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } });
    expect(updated).toMatchObject({ attendanceRecordId: row!.id });
    expect([...updated!.flags].sort()).toEqual(["LOW_ACCURACY", "ON_ABSENT_DAY"]);
  });

  it("then HR's list shows the contradiction on the row", async () => {
    const { employeeId } = await addEmployee(company.id);
    const site = await addSite(company.id);
    await addVisit(company.id, employeeId, site.id, { flags: ["AFTER_HOURS"] });

    await tick(TUESDAY_CLOSE);

    const { data } = await listAllRecords({ companyId: company.id, query: { page: 1, pageSize: 20, date: TUESDAY } as never });
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ status: "ABSENT", siteVisitFlags: ["ON_ABSENT_DAY"] });
  });

  it("on ON_LEAVE: linked, and stays AFTER_HOURS, like a visit made after the row existed", async () => {
    const { employeeId } = await addEmployee(company.id);
    const leaveType = await platformPrisma.leaveType.findFirstOrThrow({ where: { companyId: company.id } });
    await platformPrisma.leaveRequest.create({
      data: { companyId: company.id, employeeId, leaveTypeId: leaveType.id, startDate: date(TUESDAY), endDate: date(TUESDAY), totalDays: 1, status: "APPROVED", reason: "Test" },
    });
    const site = await addSite(company.id);
    const visit = await addVisit(company.id, employeeId, site.id, { flags: ["AFTER_HOURS"] });

    await tick(TUESDAY_CLOSE);

    const row = await rowOf(company.id, employeeId);
    expect(row).toMatchObject({ status: "ON_LEAVE" });
    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ attendanceRecordId: row!.id, flags: ["AFTER_HOURS"] });
  });

  it("doesn't link another employee's or another date's visit", async () => {
    const one = await addEmployee(company.id, "EMP-001");
    const two = await addEmployee(company.id, "EMP-002");
    const site = await addSite(company.id);
    await openRecord(company.id, two.employeeId, { checkOutAt: new Date("2026-03-03T11:30:00.000Z") });
    const hers = await addVisit(company.id, two.employeeId, site.id, { flags: ["AFTER_HOURS"] });
    const otherDate = await addVisit(company.id, one.employeeId, site.id, { workDate: date("2026-03-04"), status: "CLOSED", checkOutAt: new Date("2026-03-03T07:00:00.000Z"), flags: ["AFTER_HOURS"] });

    await tick(TUESDAY_CLOSE);

    for (const id of [hers.id, otherDate.id]) {
      expect(await platformPrisma.siteVisit.findUnique({ where: { id } })).toMatchObject({ attendanceRecordId: null, flags: ["AFTER_HOURS"] });
    }
  });
});

describe("two workers at once", () => {
  it("one row each, one notification each, one claim", async () => {
    const company = await setUpCompany();
    const absent = await addEmployee(company.id, "EMP-001");
    const forgot = await addEmployee(company.id, "EMP-002");
    const record = await openRecord(company.id, forgot.employeeId);
    const site = await addSite(company.id);
    await addVisit(company.id, forgot.employeeId, site.id, { attendanceRecordId: record.id });

    const now = new Date(TUESDAY_CLOSE);
    await Promise.all([runTick(JOBS, now), runTick(JOBS, now)]);

    expect(await platformPrisma.attendanceRecord.count({ where: { companyId: company.id, employeeId: absent.employeeId, workDate: date(TUESDAY) } })).toBe(1);
    expect(await rowOf(company.id, absent.employeeId)).toMatchObject({ status: "ABSENT" });
    expect(await rowOf(company.id, forgot.employeeId)).toMatchObject({ status: "INCOMPLETE", flags: ["AUTO_CLOSED"] });
    expect(await notificationsOf(forgot.userId!)).toHaveLength(1);
    const claims = await platformPrisma.jobRun.findMany({ where: { companyId: company.id, jobName: "attendance.dayClose", runKey: TUESDAY } });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ status: "DONE", attempts: 1 });
  });
});

describe("tenant isolation", () => {
  it("a job for one company doesn't touch another's rows", async () => {
    const a = await setUpCompany();
    const b = await setUpCompany();
    const aEmployee = await addEmployee(a.id);
    const bEmployee = await addEmployee(b.id);
    await openRecord(b.id, bEmployee.employeeId);
    const site = await addSite(b.id);
    const visit = await addVisit(b.id, bEmployee.employeeId, site.id, { checkInAt: new Date("2026-03-02T06:00:00.000Z"), workDate: date("2026-03-02") });

    const settings = await platformPrisma.companySettings.findUniqueOrThrow({ where: { companyId: a.id } });
    const now = new Date(TUESDAY_CLOSE);
    const context = { tenant: getTenantPrisma(a.id), company: { id: a.id, timezone: a.timezone }, settings, now };
    await dayCloseJob.everyTick!(context);
    await dayCloseJob.run!(context, TUESDAY);

    expect(await rowOf(a.id, aEmployee.employeeId)).toMatchObject({ status: "ABSENT" });
    expect(await rowOf(b.id, bEmployee.employeeId)).toMatchObject({ status: "LATE", autoClosedAt: null });
    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ status: "OPEN" });
    expect(await platformPrisma.attendanceRecord.count({ where: { companyId: b.id } })).toBe(1);
  });

  it("each company gets its own claim for the same date", async () => {
    const a = await setUpCompany();
    const b = await setUpCompany();
    await addEmployee(a.id);
    await addEmployee(b.id);

    await tick(TUESDAY_CLOSE);

    expect(await platformPrisma.jobRun.count({ where: { jobName: "attendance.dayClose", runKey: TUESDAY, companyId: { in: [a.id, b.id] } } })).toBe(2);
  });

  it("the same employee code in two companies gets one row in each", async () => {
    const a = await setUpCompany();
    const b = await setUpCompany();
    const aEmployee = await addEmployee(a.id, "EMP-001");
    const bEmployee = await addEmployee(b.id, "EMP-001");

    await tick(TUESDAY_CLOSE);

    expect(await rowOf(a.id, aEmployee.employeeId)).toMatchObject({ companyId: a.id, status: "ABSENT" });
    expect(await rowOf(b.id, bEmployee.employeeId)).toMatchObject({ companyId: b.id, status: "ABSENT" });
  });
});
