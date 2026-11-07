import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { runTick } from "../../lib/jobs/runner.js";
import { platformPrisma } from "../../lib/prisma.js";
import { createTestCompany, createTestUser } from "../../test/helpers.js";
import { proofDueTomorrowJob, proofOverdueJob } from "./proofReminders.job.js";

/**
 * Proof reminders with a fake clock, through the real runner so claims count too.
 * 2026-03-03 is a Tuesday. Colombo is UTC+5:30, so the default 09:00 reminder time is
 * 03:30 UTC.
 */
const TODAY = "2026-03-03";
const AT_NINE = "2026-03-03T03:30:00.000Z";
const JOBS = [proofDueTomorrowJob, proofOverdueJob];

const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const tick = (iso: string) => runTick(JOBS, new Date(iso));

async function setUp(opts: { timezone?: string; settings?: Record<string, unknown> } = {}) {
  const company = await createTestCompany();
  if (opts.timezone) await platformPrisma.company.update({ where: { id: company.id }, data: { timezone: opts.timezone } });
  if (opts.settings) await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: opts.settings });
  const sick = await platformPrisma.leaveType.findFirstOrThrow({ where: { companyId: company.id, code: "SICK" } });
  const employee = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-001" });
  const hr = await createTestUser({ companyId: company.id, role: "HR", email: `hr-${crypto.randomBytes(3).toString("hex")}@example.test` });

  async function addRequest(proofDueAt: string, overrides: Record<string, unknown> = {}, employeeId = employee.employeeId!) {
    return platformPrisma.leaveRequest.create({
      data: {
        companyId: company.id,
        employeeId,
        leaveTypeId: sick.id,
        startDate: date("2026-03-01"),
        endDate: date("2026-03-01"),
        totalDays: 1,
        status: "PENDING_MANAGER",
        proofStatus: "MISSING",
        proofDueAt: date(proofDueAt),
        ...overrides,
      },
    });
  }
  return { company, employee, hr, addRequest };
}

function notificationsOf(userId: string, type?: string) {
  return platformPrisma.notification.findMany({ where: { userId, ...(type ? { type } : {}) } });
}

describe("leave.proofDueTomorrow", () => {
  it("tells the employee once at the reminder time, pointing at the request", async () => {
    const { employee, addRequest } = await setUp();
    const request = await addRequest("2026-03-04");

    await tick(AT_NINE);
    await tick("2026-03-03T03:31:00.000Z");
    await tick("2026-03-03T05:00:00.000Z");

    const rows = await notificationsOf(employee.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "LEAVE_PROOF_DUE_SOON",
      title: "Leave proof due tomorrow",
      relatedEntityType: "LeaveRequest",
      relatedEntityId: request.id,
    });
    expect(rows[0]!.body).toBe("Please upload your proof for Sick Leave (01 Mar 2026) by 04 Mar 2026.");
  });

  it("waits for the reminder time, and skips the day if the worker is back over 2 hours late", async () => {
    const { employee, addRequest } = await setUp();
    await addRequest("2026-03-04");

    await tick("2026-03-03T03:29:59.000Z");
    expect(await notificationsOf(employee.user.id)).toHaveLength(0);

    await tick("2026-03-03T05:30:00.000Z");
    expect(await notificationsOf(employee.user.id)).toHaveLength(0);
    expect(await platformPrisma.jobRun.count({ where: { jobName: "leave.proofDueTomorrow" } })).toBe(0);
  });

  it("follows the company's own reminder time and timezone", async () => {
    // New York is UTC-5 on 3 Mar 2026 (summer time starts on the 8th), so 14:30 there is 19:30 UTC.
    const { employee, addRequest } = await setUp({ timezone: "America/New_York", settings: { dailyReminderTime: "14:30" } });
    await addRequest("2026-03-04");

    await tick("2026-03-03T19:29:00.000Z");
    expect(await notificationsOf(employee.user.id)).toHaveLength(0);
    await tick("2026-03-03T19:30:00.000Z");
    expect(await notificationsOf(employee.user.id)).toHaveLength(1);
  });

  it("sends nothing, and claims nothing, with proof reminders switched off", async () => {
    const { employee, addRequest } = await setUp({ settings: { proofRemindersEnabled: false } });
    await addRequest("2026-03-04");

    await tick(AT_NINE);

    expect(await notificationsOf(employee.user.id)).toHaveLength(0);
    expect(await platformPrisma.jobRun.count()).toBe(1); // the heartbeat only
  });

  it("only for proof still owed, on a request still open, due exactly tomorrow", async () => {
    const { employee, addRequest } = await setUp();
    const owed = await Promise.all([
      addRequest("2026-03-04", { proofStatus: "MISSING", status: "APPROVED" }),
      addRequest("2026-03-04", { proofStatus: "INFO_REQUIRED" }),
      addRequest("2026-03-04", { proofStatus: "REJECTED", status: "PENDING_HR" }),
    ]);
    await Promise.all([
      addRequest("2026-03-04", { proofStatus: "SUBMITTED" }),
      addRequest("2026-03-04", { proofStatus: "ACCEPTED" }),
      addRequest("2026-03-04", { proofStatus: "NOT_REQUIRED", proofDueAt: null }),
      addRequest("2026-03-04", { status: "CANCELLED" }),
      addRequest("2026-03-04", { status: "REJECTED" }),
      addRequest("2026-03-04", { status: "REVOKED" }),
      addRequest("2026-03-03"),
      addRequest("2026-03-05"),
    ]);

    await tick(AT_NINE);

    const rows = await notificationsOf(employee.user.id);
    expect(rows.map((row) => row.relatedEntityId).sort()).toEqual(owed.map((request) => request.id).sort());
    expect(rows.find((row) => row.relatedEntityId === owed[1]!.id)!.body).toContain("HR asked for more information");
    expect(rows.find((row) => row.relatedEntityId === owed[2]!.id)!.body).toContain("wasn't accepted");
  });

  it("skips an employee with no active login, or who has left", async () => {
    const { company, addRequest } = await setUp();
    const deactivated = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-002", status: "DEACTIVATED" });
    const left = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-003" });
    await platformPrisma.employee.update({ where: { id: left.employeeId! }, data: { status: "INACTIVE" } });
    await addRequest("2026-03-04", {}, deactivated.employeeId!);
    await addRequest("2026-03-04", {}, left.employeeId!);

    await tick(AT_NINE);

    expect(await platformPrisma.notification.count({ where: { type: "LEAVE_PROOF_DUE_SOON" } })).toBe(0);
  });
});

describe("leave.proofOverdue", () => {
  it("tells every active HR user except the requester, once, and never again on later days", async () => {
    const { company, hr, addRequest } = await setUp();
    const hrEmployee = await createTestUser({ companyId: company.id, role: "HR", employeeCode: "EMP-010", email: "hr-employee@example.test" });
    const deactivatedHr = await createTestUser({ companyId: company.id, role: "HR", email: "old-hr@example.test", status: "DEACTIVATED" });
    const admin = await createTestUser({ companyId: company.id, role: "COMPANY_ADMIN", email: "admin@example.test" });
    const request = await addRequest("2026-03-02");
    const ownRequest = await addRequest("2026-03-02", {}, hrEmployee.employeeId!);

    await tick(AT_NINE);
    await tick("2026-03-04T03:30:00.000Z");
    await tick("2026-03-05T03:30:00.000Z");

    const toHr = await notificationsOf(hr.user.id, "LEAVE_PROOF_OVERDUE");
    expect(toHr.map((row) => row.relatedEntityId).sort()).toEqual([request.id, ownRequest.id].sort());
    expect(toHr.find((row) => row.relatedEntityId === request.id)).toMatchObject({
      title: "Leave proof overdue",
      body: "Test User hasn't uploaded proof for Sick Leave (01 Mar 2026). It was due on 02 Mar 2026.",
      relatedEntityType: "LeaveRequest",
    });
    // The HR employee hears about others' requests, not their own.
    expect((await notificationsOf(hrEmployee.user.id, "LEAVE_PROOF_OVERDUE")).map((row) => row.relatedEntityId)).toEqual([request.id]);
    expect(await notificationsOf(deactivatedHr.user.id)).toHaveLength(0);
    expect(await notificationsOf(admin.user.id)).toHaveLength(0);
  });

  it("isn't overdue on its due date, only from the day after", async () => {
    const { hr, addRequest } = await setUp();
    await addRequest(TODAY);

    await tick(AT_NINE);
    expect(await notificationsOf(hr.user.id)).toHaveLength(0);

    await tick("2026-03-04T03:30:00.000Z");
    expect(await notificationsOf(hr.user.id, "LEAVE_PROOF_OVERDUE")).toHaveLength(1);
  });

  it("doesn't go to the employee, and stops once proof is in", async () => {
    const { employee, hr, addRequest } = await setUp();
    await addRequest("2026-03-01", { proofStatus: "SUBMITTED" });

    await tick(AT_NINE);

    expect(await notificationsOf(hr.user.id)).toHaveLength(0);
    expect(await notificationsOf(employee.user.id, "LEAVE_PROOF_OVERDUE")).toHaveLength(0);
  });

  it("two workers at once: one notification each", async () => {
    const { employee, hr, addRequest } = await setUp();
    await addRequest("2026-03-02");
    await addRequest("2026-03-04");

    await Promise.all([tick(AT_NINE), tick(AT_NINE)]);

    expect(await notificationsOf(hr.user.id)).toHaveLength(1);
    expect(await notificationsOf(employee.user.id)).toHaveLength(1);
  });

  it("cross-tenant: each company's HR hears only about its own requests", async () => {
    const a = await setUp();
    const b = await setUp();
    const requestA = await a.addRequest("2026-03-02");
    const requestB = await b.addRequest("2026-03-02");

    await tick(AT_NINE);

    expect((await notificationsOf(a.hr.user.id)).map((row) => [row.companyId, row.relatedEntityId])).toEqual([[a.company.id, requestA.id]]);
    expect((await notificationsOf(b.hr.user.id)).map((row) => [row.companyId, row.relatedEntityId])).toEqual([[b.company.id, requestB.id]]);
  });

  it("does nothing for a suspended company", async () => {
    const { company, hr, addRequest } = await setUp();
    await addRequest("2026-03-02");
    await platformPrisma.company.update({ where: { id: company.id }, data: { status: "SUSPENDED" } });

    await tick(AT_NINE);

    expect(await notificationsOf(hr.user.id)).toHaveLength(0);
  });
});
