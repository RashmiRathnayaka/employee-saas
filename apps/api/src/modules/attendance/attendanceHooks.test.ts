import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { JOBS } from "../../jobs.js";
import { runTick } from "../../lib/jobs/runner.js";
import { platformPrisma } from "../../lib/prisma.js";
import { createEmployeeWithLogin, createTestCompany, createTestUser, getLeaveTypeIdByCode, setUpCompanyWithUser } from "../../test/helpers.js";

/**
 * The hooks, through the real endpoints: a decision in another module must leave past
 * attendance rows right, in the same transaction. The clock is fixed so that "last
 * Tuesday" stays in the sick-leave window. 2026-03-03 is that Tuesday.
 */
const TUESDAY = "2026-03-03";
const WEDNESDAY = "2026-03-04";
const SNAPSHOT = { scheduledStartAt: new Date("2026-03-03T03:30:00.000Z"), scheduledEndAt: new Date("2026-03-03T11:30:00.000Z") };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-10T06:00:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function absentRow(companyId: string, employeeId: string, workDate = TUESDAY, overrides: Record<string, unknown> = {}) {
  return platformPrisma.attendanceRecord.create({
    data: { companyId, employeeId, workDate: date(workDate), status: "ABSENT", source: "SYSTEM", ...SNAPSHOT, ...overrides },
  });
}

function checkedInRow(companyId: string, employeeId: string, workDate = TUESDAY, overrides: Record<string, unknown> = {}) {
  return platformPrisma.attendanceRecord.create({
    data: {
      companyId,
      employeeId,
      workDate: date(workDate),
      status: "LATE",
      lateMinutes: 30,
      source: "MOBILE",
      ...SNAPSHOT,
      checkInAt: new Date("2026-03-03T04:00:00.000Z"),
      checkOutAt: new Date("2026-03-03T11:30:00.000Z"),
      workedMinutes: 450,
      ...overrides,
    },
  });
}

async function addVisit(companyId: string, employeeId: string, recordId: string | null, flags: string[]) {
  const { user } = await createTestUser({ companyId, role: "HR", email: `hr-${crypto.randomBytes(3).toString("hex")}@example.test` });
  const site = await platformPrisma.site.create({
    data: { companyId, name: `Site ${crypto.randomBytes(3).toString("hex")}`, type: "EXTERNAL", radiusMeters: 200, gpsRequired: false, createdByUserId: user.id },
  });
  return platformPrisma.siteVisit.create({
    data: {
      companyId,
      employeeId,
      siteId: site.id,
      attendanceRecordId: recordId,
      workDate: date(TUESDAY),
      status: "CLOSED",
      checkInAt: new Date("2026-03-03T14:00:00.000Z"),
      checkOutAt: new Date("2026-03-03T15:00:00.000Z"),
      durationMinutes: 60,
      flags,
      clientRequestId: crypto.randomUUID(),
    },
  });
}

const reload = (id: string) => platformPrisma.attendanceRecord.findUniqueOrThrow({ where: { id } });

async function setUpLeave() {
  const app = createApp();
  const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
  const { employee: manager, token: managerToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
    firstName: "Manager",
    email: `manager-${crypto.randomBytes(3).toString("hex")}@example.test`,
    role: "MANAGER",
  });
  const { employee, token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
    firstName: "Alex",
    email: `alex-${crypto.randomBytes(3).toString("hex")}@example.test`,
    managerId: manager.id,
  });
  const sickTypeId = await getLeaveTypeIdByCode(app, adminToken, "SICK");
  const annualTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

  const submit = async (body: Record<string, unknown>) => {
    const res = await request(app).post("/api/v1/leave-requests").set("Authorization", employeeToken).send({ leaveTypeId: sickTypeId, startDate: TUESDAY, endDate: TUESDAY, ...body });
    expect(res.status).toBe(201);
    return res.body.leaveRequest.id as string;
  };
  const approve = async (id: string, token = managerToken) => {
    const res = await request(app).patch(`/api/v1/leave-requests/${id}/approve`).set("Authorization", token).send({});
    expect(res.status).toBe(200);
    return res;
  };
  return { app, adminToken, company, manager, managerToken, employee, employeeToken, annualTypeId, submit, approve };
}

describe("leave approved", () => {
  it("flips a past ABSENT row to ON_LEAVE, keeping its schedule", async () => {
    const { company, employee, submit, approve } = await setUpLeave();
    const row = await absentRow(company.id, employee.id);

    await approve(await submit({}));

    expect(await reload(row.id)).toMatchObject({ status: "ON_LEAVE", flags: [], ...SNAPSHOT });
  });

  it("flips every day of the range, and only those", async () => {
    const { company, employee, submit, approve } = await setUpLeave();
    const before = await absentRow(company.id, employee.id, "2026-03-02");
    const first = await absentRow(company.id, employee.id, TUESDAY);
    const second = await absentRow(company.id, employee.id, WEDNESDAY);
    const after = await absentRow(company.id, employee.id, "2026-03-05");

    await approve(await submit({ startDate: TUESDAY, endDate: WEDNESDAY }));

    expect(await reload(first.id)).toMatchObject({ status: "ON_LEAVE" });
    expect(await reload(second.id)).toMatchObject({ status: "ON_LEAVE" });
    expect(await reload(before.id)).toMatchObject({ status: "ABSENT" });
    expect(await reload(after.id)).toMatchObject({ status: "ABSENT" });
  });

  it("half a day counts as on leave, with the flag (Q8)", async () => {
    const { company, employee, submit, approve } = await setUpLeave();
    const row = await absentRow(company.id, employee.id);

    await approve(await submit({ startHalfDay: true }));

    expect(await reload(row.id)).toMatchObject({ status: "ON_LEAVE", flags: ["HALF_DAY_LEAVE"] });
  });

  it("doesn't touch a colleague's row", async () => {
    const { company, employee, manager, submit, approve } = await setUpLeave();
    await absentRow(company.id, employee.id);
    const colleague = await absentRow(company.id, manager.id);

    await approve(await submit({}));

    expect(await reload(colleague.id)).toMatchObject({ status: "ABSENT" });
  });

  it("a day they did check in on keeps its times and status, and gains the flag (§1.5)", async () => {
    const { company, employee, submit, approve } = await setUpLeave();
    const row = await checkedInRow(company.id, employee.id);

    await approve(await submit({}));

    expect(await reload(row.id)).toMatchObject({ status: "LATE", lateMinutes: 30, workedMinutes: 450, flags: ["ON_APPROVED_LEAVE"] });
  });

  it("a check-in on a day off doesn't gain the flag: leave isn't spent on it", async () => {
    const { company, employee, submit, approve } = await setUpLeave();
    const row = await checkedInRow(company.id, employee.id, TUESDAY, { flags: ["NON_WORKING_DAY"] });

    await approve(await submit({}));

    expect(await reload(row.id)).toMatchObject({ flags: ["NON_WORKING_DAY"] });
  });

  it("a row on a holiday stays HOLIDAY", async () => {
    const { company, employee, submit, approve } = await setUpLeave();
    const row = await absentRow(company.id, employee.id, TUESDAY, { status: "HOLIDAY", scheduledStartAt: null, scheduledEndAt: null });
    await platformPrisma.companyHoliday.create({ data: { companyId: company.id, date: date(TUESDAY), name: "Poya" } });

    // A one-day leave on that holiday would count no days, so it spans the next day too.
    await approve(await submit({ startDate: TUESDAY, endDate: WEDNESDAY }));

    expect(await reload(row.id)).toMatchObject({ status: "HOLIDAY" });
  });

  it("clears the contradiction in HR's list, and the visit keeps its flag as a record (§1.6)", async () => {
    const { app, adminToken, company, employee, submit, approve } = await setUpLeave();
    await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { enabledModules: { attendance: true, sites: true } } });
    const row = await absentRow(company.id, employee.id);
    const visit = await addVisit(company.id, employee.id, row.id, ["ON_ABSENT_DAY"]);

    await approve(await submit({}));

    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ flags: ["ON_ABSENT_DAY"] });
    const list = await request(app).get(`/api/v1/attendance?date=${TUESDAY}`).set("Authorization", adminToken);
    const listed = list.body.data.find((item: { id: string }) => item.id === row.id);
    expect(listed).toMatchObject({ status: "ON_LEAVE", siteVisitFlags: [] });
  });

  describe("under MANAGER_THEN_HR", () => {
    it("the manager's step changes nothing, and HR's final step flips the row", async () => {
      const { app, adminToken, company, employee, submit, approve } = await setUpLeave();
      await request(app).patch("/api/v1/company/settings").set("Authorization", adminToken).send({ leaveApprovalWorkflow: "MANAGER_THEN_HR" });
      const { token: hrToken } = await createEmployeeWithLogin(app, adminToken, company.code, { firstName: "HR", email: "hr-final@example.test", role: "HR" });
      const row = await absentRow(company.id, employee.id);
      const id = await submit({});

      await approve(id);
      expect(await reload(row.id)).toMatchObject({ status: "ABSENT" });

      await approve(id, hrToken);
      expect(await reload(row.id)).toMatchObject({ status: "ON_LEAVE" });
    });
  });

  it("a rejected leave changes nothing", async () => {
    const { app, company, employee, managerToken, submit } = await setUpLeave();
    const row = await absentRow(company.id, employee.id);
    const id = await submit({});

    await request(app).patch(`/api/v1/leave-requests/${id}/reject`).set("Authorization", managerToken).send({ note: "No" });

    expect(await reload(row.id)).toMatchObject({ status: "ABSENT" });
  });

  it("works with the attendance module switched off since: the past row should still be right", async () => {
    const { company, employee, submit, approve } = await setUpLeave();
    await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { enabledModules: {} } });
    const row = await absentRow(company.id, employee.id);

    await approve(await submit({}));

    expect(await reload(row.id)).toMatchObject({ status: "ON_LEAVE" });
  });

  it("another company's row for the same date is out of reach", async () => {
    const { company, employee, submit, approve } = await setUpLeave();
    await absentRow(company.id, employee.id);
    const other = await createTestCompany();
    const { employeeId: otherEmployeeId } = await createTestUser({ companyId: other.id, role: "EMPLOYEE", employeeCode: "EMP-001" });
    const otherRow = await absentRow(other.id, otherEmployeeId!);

    await approve(await submit({}));

    expect(await reload(otherRow.id)).toMatchObject({ status: "ABSENT" });
  });
});

describe("leave revoked", () => {
  /** Revoking is only allowed before the leave starts, so nothing should exist for those
   * dates yet. These rows are placed by hand to prove the hook's effect all the same. */
  const FUTURE = "2026-03-20";

  async function approvedFutureLeave() {
    const context = await setUpLeave();
    const id = await context.submit({ leaveTypeId: context.annualTypeId, startDate: FUTURE, endDate: FUTURE });
    await context.approve(id);
    const { token: hrToken } = await createEmployeeWithLogin(context.app, context.adminToken, context.company.code, { firstName: "HR", email: "hr-revoke@example.test", role: "HR" });
    const revoke = async () => {
      const res = await request(context.app).patch(`/api/v1/leave-requests/${id}/revoke`).set("Authorization", hrToken).send({ note: "Needed" });
      expect(res.status).toBe(200);
    };
    return { ...context, revoke };
  }

  it("ON_LEAVE with no check-in goes back to ABSENT", async () => {
    const { company, employee, revoke } = await approvedFutureLeave();
    const row = await absentRow(company.id, employee.id, FUTURE, { status: "ON_LEAVE", flags: ["HALF_DAY_LEAVE"] });

    await revoke();

    expect(await reload(row.id)).toMatchObject({ status: "ABSENT", flags: [] });
  });

  it("a day with a check-in only loses the flag", async () => {
    const { company, employee, revoke } = await approvedFutureLeave();
    const row = await checkedInRow(company.id, employee.id, FUTURE, { flags: ["ON_APPROVED_LEAVE", "LOW_ACCURACY"] });

    await revoke();

    expect(await reload(row.id)).toMatchObject({ status: "LATE", flags: ["LOW_ACCURACY"] });
  });

  it("a visit on what's now an ABSENT day becomes ON_ABSENT_DAY, so HR sees it", async () => {
    const { company, employee, revoke } = await approvedFutureLeave();
    const row = await absentRow(company.id, employee.id, FUTURE, { status: "ON_LEAVE" });
    const visit = await addVisit(company.id, employee.id, row.id, ["AFTER_HOURS", "LOW_ACCURACY"]);

    await revoke();

    const updated = await platformPrisma.siteVisit.findUniqueOrThrow({ where: { id: visit.id } });
    expect([...updated.flags].sort()).toEqual(["LOW_ACCURACY", "ON_ABSENT_DAY"]);
  });
});

describe("leave cancelled", () => {
  it("only a pending leave can be cancelled, and that never wrote a row, so an ABSENT row stays", async () => {
    const { app, company, employee, employeeToken, submit } = await setUpLeave();
    const row = await absentRow(company.id, employee.id);
    const id = await submit({});

    const res = await request(app).patch(`/api/v1/leave-requests/${id}/cancel`).set("Authorization", employeeToken).send({});

    expect(res.status).toBe(200);
    expect(await reload(row.id)).toMatchObject({ status: "ABSENT" });
  });

  it("a row left ON_LEAVE with no leave behind it is put right", async () => {
    const { app, company, employee, employeeToken, submit } = await setUpLeave();
    const row = await absentRow(company.id, employee.id, TUESDAY, { status: "ON_LEAVE" });
    const id = await submit({});

    await request(app).patch(`/api/v1/leave-requests/${id}/cancel`).set("Authorization", employeeToken).send({});

    expect(await reload(row.id)).toMatchObject({ status: "ABSENT" });
  });
});

describe("holidays", () => {
  async function setUpHoliday() {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { employeeId } = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-001" });
    const addHoliday = async (holidayDate = TUESDAY) => {
      const res = await request(app).post("/api/v1/company/holidays").set("Authorization", token).send({ date: holidayDate, name: "Poya" });
      expect(res.status).toBe(201);
      return res.body.holiday?.id ?? res.body.id;
    };
    const deleteHoliday = (id: string) => request(app).delete(`/api/v1/company/holidays/${id}`).set("Authorization", token);
    return { app, token, company, employeeId: employeeId!, addHoliday, deleteHoliday };
  }

  it("adding one flips that date's ABSENT rows to HOLIDAY, and clears the schedule snapshot", async () => {
    const { company, employeeId, addHoliday } = await setUpHoliday();
    const row = await absentRow(company.id, employeeId);
    const otherDay = await absentRow(company.id, employeeId, WEDNESDAY);

    await addHoliday();

    expect(await reload(row.id)).toMatchObject({ status: "HOLIDAY", scheduledStartAt: null, scheduledEndAt: null });
    expect(await reload(otherDay.id)).toMatchObject({ status: "ABSENT" });
  });

  it("flips everyone in the company, and nobody in another", async () => {
    const { company, employeeId, addHoliday } = await setUpHoliday();
    const { employeeId: secondId } = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-002" });
    const one = await absentRow(company.id, employeeId);
    const two = await absentRow(company.id, secondId!);
    const other = await createTestCompany();
    const { employeeId: otherEmployeeId } = await createTestUser({ companyId: other.id, role: "EMPLOYEE", employeeCode: "EMP-001" });
    const otherRow = await absentRow(other.id, otherEmployeeId!);

    await addHoliday();

    expect(await reload(one.id)).toMatchObject({ status: "HOLIDAY" });
    expect(await reload(two.id)).toMatchObject({ status: "HOLIDAY" });
    expect(await reload(otherRow.id)).toMatchObject({ status: "ABSENT" });
  });

  it("a row with a check-in stays as it is: they really came in", async () => {
    const { company, employeeId, addHoliday } = await setUpHoliday();
    const row = await checkedInRow(company.id, employeeId);

    await addHoliday();

    expect(await reload(row.id)).toMatchObject({ status: "LATE", lateMinutes: 30, ...SNAPSHOT });
  });

  it("an HR correction of the flipped day isn't judged against the old shift", async () => {
    const { app, token, company, employeeId, addHoliday } = await setUpHoliday();
    await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { enabledModules: { attendance: true } } });
    const row = await absentRow(company.id, employeeId);
    await addHoliday();

    const res = await request(app)
      .patch(`/api/v1/attendance/${row.id}/correct`)
      .set("Authorization", token)
      .send({ checkInAt: "2026-03-03T08:00:00.000Z", checkOutAt: "2026-03-03T11:00:00.000Z", reason: "Came in for an urgent job" });

    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({ status: "PRESENT", lateMinutes: 0 });
    expect(res.body.record.flags).toContain("NON_WORKING_DAY");
  });

  it("deleting one flips HOLIDAY rows back to ABSENT, and on to ON_LEAVE if leave covers the day", async () => {
    const { company, employeeId, addHoliday, deleteHoliday } = await setUpHoliday();
    const { employeeId: onLeaveId } = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-002" });
    const leaveType = await platformPrisma.leaveType.findFirstOrThrow({ where: { companyId: company.id } });
    await platformPrisma.leaveRequest.create({
      data: { companyId: company.id, employeeId: onLeaveId!, leaveTypeId: leaveType.id, startDate: date(TUESDAY), endDate: date(TUESDAY), totalDays: 1, status: "APPROVED", reason: "Test" },
    });
    const absent = await absentRow(company.id, employeeId);
    const onLeave = await absentRow(company.id, onLeaveId!);
    const holidayId = await addHoliday();
    expect(await reload(onLeave.id)).toMatchObject({ status: "HOLIDAY" });

    const res = await deleteHoliday(holidayId);

    expect(res.status).toBeLessThan(300);
    expect(await reload(absent.id)).toMatchObject({ status: "ABSENT" });
    expect(await reload(onLeave.id)).toMatchObject({ status: "ON_LEAVE" });
  });

  it("deleting one makes a linked AFTER_HOURS visit ON_ABSENT_DAY", async () => {
    const { company, employeeId, addHoliday, deleteHoliday } = await setUpHoliday();
    const row = await absentRow(company.id, employeeId);
    const holidayId = await addHoliday();
    const visit = await addVisit(company.id, employeeId, row.id, ["AFTER_HOURS"]);

    await deleteHoliday(holidayId);

    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ flags: ["ON_ABSENT_DAY"] });
  });
});

describe("employee deactivated", () => {
  async function setUpDeactivation() {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { employee } = await createEmployeeWithLogin(app, token, company.code, { firstName: "Alex", email: "alex@example.test" });
    const deactivate = () => request(app).patch(`/api/v1/employees/${employee.id}/status`).set("Authorization", token).send({ status: "INACTIVE" });
    return { app, token, company, employee, deactivate };
  }

  const openOverrides = { checkOutAt: null, workedMinutes: null };

  it("closes their open record now, not at its close time", async () => {
    const { company, employee, deactivate } = await setUpDeactivation();
    const row = await checkedInRow(company.id, employee.id, "2026-03-10", {
      ...openOverrides,
      scheduledEndAt: new Date("2026-03-10T11:30:00.000Z"),
      checkInAt: new Date("2026-03-10T04:00:00.000Z"),
    });

    const res = await deactivate();

    expect(res.status).toBe(200);
    expect(await reload(row.id)).toMatchObject({ status: "INCOMPLETE", flags: ["AUTO_CLOSED"], lateMinutes: 30, workedMinutes: null, checkOutAt: null });
    expect((await reload(row.id)).autoClosedAt).not.toBeNull();
  });

  it("closes a check-in with no schedule too", async () => {
    const { company, employee, deactivate } = await setUpDeactivation();
    const row = await checkedInRow(company.id, employee.id, "2026-03-08", { ...openOverrides, scheduledStartAt: null, scheduledEndAt: null, flags: ["NON_WORKING_DAY"] });

    await deactivate();

    expect(await reload(row.id)).toMatchObject({ status: "INCOMPLETE", flags: ["NON_WORKING_DAY", "AUTO_CLOSED"] });
  });

  it("closes every open visit, linked or not, and sends no 'ask HR' notification", async () => {
    const { company, employee, deactivate } = await setUpDeactivation();
    const row = await checkedInRow(company.id, employee.id, "2026-03-10", { ...openOverrides, scheduledEndAt: new Date("2026-03-10T11:30:00.000Z") });
    const visit = await addVisit(company.id, employee.id, row.id, []);
    await platformPrisma.siteVisit.update({ where: { id: visit.id }, data: { status: "OPEN", checkOutAt: null, durationMinutes: null } });

    await deactivate();

    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ status: "AUTO_CLOSED" });
    expect(await platformPrisma.notification.count({ where: { type: "ATTENDANCE_AUTO_CLOSED" } })).toBe(0);
  });

  it("closes an open visit that has no record, and says what it closed in the audit", async () => {
    const { company, employee, deactivate } = await setUpDeactivation();
    const visit = await addVisit(company.id, employee.id, null, []);
    await platformPrisma.siteVisit.update({ where: { id: visit.id }, data: { status: "OPEN", checkOutAt: null, durationMinutes: null } });

    await deactivate();

    expect(await platformPrisma.siteVisit.findUnique({ where: { id: visit.id } })).toMatchObject({ status: "AUTO_CLOSED" });
    const audit = await platformPrisma.auditLog.findFirst({ where: { companyId: company.id, action: "EMPLOYEE_DEACTIVATED" } });
    expect(audit?.metadata).toEqual({ closedRecords: 0, closedVisits: 1 });
  });

  it("leaves a checked-out record and a colleague's open record alone", async () => {
    const { app, token, company, employee, deactivate } = await setUpDeactivation();
    const done = await checkedInRow(company.id, employee.id);
    const { employee: colleague } = await createEmployeeWithLogin(app, token, company.code, { firstName: "Jo", email: "jo@example.test" });
    const theirs = await checkedInRow(company.id, colleague.id, "2026-03-10", { ...openOverrides, scheduledEndAt: new Date("2026-03-10T11:30:00.000Z") });

    await deactivate();

    expect(await reload(done.id)).toMatchObject({ status: "LATE", autoClosedAt: null });
    expect(await reload(theirs.id)).toMatchObject({ status: "LATE", autoClosedAt: null });
  });

  it("the job then has nothing left to do, and sends nothing", async () => {
    const { company, employee, deactivate } = await setUpDeactivation();
    await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { enabledModules: { attendance: true, sites: true } } });
    await checkedInRow(company.id, employee.id, "2026-03-10", { ...openOverrides, scheduledEndAt: new Date("2026-03-10T11:30:00.000Z") });

    await deactivate();
    await runTick(JOBS, new Date("2026-03-11T00:00:00.000Z"));

    expect(await platformPrisma.notification.count({ where: { type: "ATTENDANCE_AUTO_CLOSED" } })).toBe(0);
  });

  it("reactivating closes nothing and changes nothing", async () => {
    const { app, token, company, employee, deactivate } = await setUpDeactivation();
    const row = await checkedInRow(company.id, employee.id, "2026-03-10", { ...openOverrides, scheduledEndAt: new Date("2026-03-10T11:30:00.000Z") });
    await deactivate();
    const closedAt = (await reload(row.id)).autoClosedAt;

    await request(app).patch(`/api/v1/employees/${employee.id}/status`).set("Authorization", token).send({ status: "ACTIVE" });

    expect(await reload(row.id)).toMatchObject({ status: "INCOMPLETE", autoClosedAt: closedAt });
  });
});

describe("switching attendance on", () => {
  async function setUpSettings() {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const patch = async (enabledModules: Record<string, boolean>) => {
      const res = await request(app).patch("/api/v1/company/settings").set("Authorization", token).send({ enabledModules });
      expect(res.status).toBe(200);
    };
    const enabledAt = async () => (await platformPrisma.companySettings.findUniqueOrThrow({ where: { companyId: company.id } })).attendanceEnabledAt;
    return { patch, enabledAt };
  }

  it("records the moment", async () => {
    const { patch, enabledAt } = await setUpSettings();
    expect(await enabledAt()).toBeNull();

    await patch({ attendance: true });

    expect(await enabledAt()).toEqual(new Date());
  });

  it("saving it again, or another module, doesn't move it", async () => {
    const { patch, enabledAt } = await setUpSettings();
    await patch({ attendance: true });
    const first = await enabledAt();
    vi.setSystemTime(new Date("2026-03-10T06:01:00.000Z"));

    await patch({ attendance: true });
    await patch({ sites: true });

    expect(await enabledAt()).toEqual(first);
    vi.setSystemTime(new Date("2026-03-10T06:00:00.000Z"));
  });

  it("switching it off and on again starts counting from the new moment", async () => {
    const { patch, enabledAt } = await setUpSettings();
    await patch({ attendance: true });
    await patch({ attendance: false });
    const later = new Date("2026-03-10T06:01:00.000Z");
    vi.setSystemTime(later);

    await patch({ attendance: true });

    expect(await enabledAt()).toEqual(later);
    vi.setSystemTime(new Date("2026-03-10T06:00:00.000Z"));
  });

  it("another module alone doesn't set it", async () => {
    const { patch, enabledAt } = await setUpSettings();

    await patch({ sites: true });

    expect(await enabledAt()).toBeNull();
  });
});
