import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { platformPrisma } from "../../lib/prisma.js";
import { createEmployeeWithLogin, createTestUser, getLeaveTypeIdByCode, setUpCompanyWithUser } from "../../test/helpers.js";

// Leave dates below (March 2026) are fixed fixtures, so "today" is frozen
// before them. Only Date is faked.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

type App = ReturnType<typeof createApp>;

async function seedNotification(params: { companyId: string; userId: string; title?: string; createdAt?: Date; readAt?: Date }) {
  return platformPrisma.notification.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      type: "LEAVE_REQUEST_APPROVED",
      title: params.title ?? "Test notification",
      body: "Body",
      relatedEntityType: "LeaveRequest",
      relatedEntityId: "00000000-0000-0000-0000-000000000000",
      createdAt: params.createdAt,
      readAt: params.readAt,
    },
  });
}

/** Two users in company A, one in company B. */
async function setUpTwoCompanies(app: App) {
  const a1 = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
  const { employee: a2Employee, token: a2Token } = await createEmployeeWithLogin(app, a1.token, a1.company.code, {
    firstName: "Second",
    email: "a2@example.test",
  });
  const a2User = await platformPrisma.user.findFirstOrThrow({ where: { employeeId: a2Employee.id } });
  const b = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
  return { a1, a2: { user: a2User, token: a2Token }, b };
}

describe("notifications endpoints", () => {
  it("lists only the caller's own notifications, newest first", async () => {
    const app = createApp();
    const { a1, a2, b } = await setUpTwoCompanies(app);
    await seedNotification({ companyId: a1.company.id, userId: a1.user.id, title: "older", createdAt: new Date("2026-01-10T00:00:00Z") });
    await seedNotification({ companyId: a1.company.id, userId: a1.user.id, title: "newer", createdAt: new Date("2026-01-11T00:00:00Z") });
    await seedNotification({ companyId: a1.company.id, userId: a2.user.id, title: "a2's" });
    await seedNotification({ companyId: b.company.id, userId: b.user.id, title: "b's" });

    const res = await request(app).get("/api/v1/notifications").set("Authorization", a1.token);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data.map((n: { title: string }) => n.title)).toEqual(["newer", "older"]);
    expect(res.body.data[0]).toMatchObject({
      type: "LEAVE_REQUEST_APPROVED",
      relatedEntityType: "LeaveRequest",
      readAt: null,
    });

    const bRes = await request(app).get("/api/v1/notifications").set("Authorization", b.token);
    expect(bRes.body.data.map((n: { title: string }) => n.title)).toEqual(["b's"]);
  });

  it("paginates and filters unreadOnly", async () => {
    const app = createApp();
    const { company, user, token } = await setUpCompanyWithUser(app, { role: "HR" });
    for (let i = 0; i < 25; i++) {
      await seedNotification({
        companyId: company.id,
        userId: user.id,
        title: `n${i}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
        // every 5th one is already read
        readAt: i % 5 === 0 ? new Date("2026-01-14T00:00:00Z") : undefined,
      });
    }

    const page1 = await request(app).get("/api/v1/notifications?page=1&pageSize=10").set("Authorization", token);
    expect(page1.body).toMatchObject({ page: 1, pageSize: 10, total: 25 });
    expect(page1.body.data).toHaveLength(10);
    expect(page1.body.data[0].title).toBe("n24");

    const page3 = await request(app).get("/api/v1/notifications?page=3&pageSize=10").set("Authorization", token);
    expect(page3.body.data.map((n: { title: string }) => n.title)).toEqual(["n4", "n3", "n2", "n1", "n0"]);

    const unread = await request(app).get("/api/v1/notifications?unreadOnly=true&pageSize=100").set("Authorization", token);
    expect(unread.body.total).toBe(20);
    expect(unread.body.data.every((n: { readAt: string | null }) => n.readAt === null)).toBe(true);

    const notUnreadOnly = await request(app).get("/api/v1/notifications?unreadOnly=false").set("Authorization", token);
    expect(notUnreadOnly.body.total).toBe(25);

    const tooBig = await request(app).get("/api/v1/notifications?pageSize=101").set("Authorization", token);
    expect(tooBig.status).toBe(400);
  });

  it("returns the unread count for the caller only", async () => {
    const app = createApp();
    const { a1, a2, b } = await setUpTwoCompanies(app);
    await seedNotification({ companyId: a1.company.id, userId: a1.user.id });
    await seedNotification({ companyId: a1.company.id, userId: a1.user.id });
    await seedNotification({ companyId: a1.company.id, userId: a1.user.id, readAt: new Date() });
    await seedNotification({ companyId: a1.company.id, userId: a2.user.id });
    await seedNotification({ companyId: b.company.id, userId: b.user.id });

    const res = await request(app).get("/api/v1/notifications/unread-count").set("Authorization", a1.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 2 });
  });

  it("marks one read, idempotently, keeping the first readAt", async () => {
    const app = createApp();
    const { company, user, token } = await setUpCompanyWithUser(app, { role: "MANAGER" });
    const n = await seedNotification({ companyId: company.id, userId: user.id });

    const first = await request(app).patch(`/api/v1/notifications/${n.id}/read`).set("Authorization", token);
    expect(first.status).toBe(200);
    expect(first.body.notification.readAt).not.toBeNull();

    vi.setSystemTime(new Date("2026-01-15T00:01:00.000Z")); // a minute later (within the access token's lifetime)
    const second = await request(app).patch(`/api/v1/notifications/${n.id}/read`).set("Authorization", token);
    vi.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));
    expect(second.status).toBe(200);
    expect(second.body.notification.readAt).toBe(first.body.notification.readAt);

    const count = await request(app).get("/api/v1/notifications/unread-count").set("Authorization", token);
    expect(count.body.count).toBe(0);
  });

  it("returns 404 for another user's or another company's notification, and leaves it unread", async () => {
    const app = createApp();
    const { a1, a2, b } = await setUpTwoCompanies(app);
    const a2Notification = await seedNotification({ companyId: a1.company.id, userId: a2.user.id });
    const bNotification = await seedNotification({ companyId: b.company.id, userId: b.user.id });

    const sameCompany = await request(app).patch(`/api/v1/notifications/${a2Notification.id}/read`).set("Authorization", a1.token);
    expect(sameCompany.status).toBe(404);
    expect(sameCompany.body.error.code).toBe("NOT_FOUND");

    const crossTenant = await request(app).patch(`/api/v1/notifications/${bNotification.id}/read`).set("Authorization", a1.token);
    expect(crossTenant.status).toBe(404);

    const missing = await request(app).patch("/api/v1/notifications/not-a-real-id/read").set("Authorization", a1.token);
    expect(missing.status).toBe(404);

    const rows = await platformPrisma.notification.findMany({ where: { id: { in: [a2Notification.id, bNotification.id] } } });
    expect(rows.every((r) => r.readAt === null)).toBe(true);
  });

  it("read-all only affects the caller's own rows", async () => {
    const app = createApp();
    const { a1, a2, b } = await setUpTwoCompanies(app);
    await seedNotification({ companyId: a1.company.id, userId: a1.user.id });
    await seedNotification({ companyId: a1.company.id, userId: a1.user.id });
    await seedNotification({ companyId: a1.company.id, userId: a1.user.id, readAt: new Date() });
    await seedNotification({ companyId: a1.company.id, userId: a2.user.id });
    await seedNotification({ companyId: b.company.id, userId: b.user.id });

    const res = await request(app).patch("/api/v1/notifications/read-all").set("Authorization", a1.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });

    expect((await request(app).get("/api/v1/notifications/unread-count").set("Authorization", a1.token)).body.count).toBe(0);
    expect((await request(app).get("/api/v1/notifications/unread-count").set("Authorization", a2.token)).body.count).toBe(1);
    expect((await request(app).get("/api/v1/notifications/unread-count").set("Authorization", b.token)).body.count).toBe(1);

    const again = await request(app).patch("/api/v1/notifications/read-all").set("Authorization", a1.token);
    expect(again.body).toEqual({ updated: 0 });
  });

  it("requires authentication", async () => {
    const app = createApp();
    expect((await request(app).get("/api/v1/notifications")).status).toBe(401);
    expect((await request(app).get("/api/v1/notifications/unread-count")).status).toBe(401);
    expect((await request(app).patch("/api/v1/notifications/read-all")).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Events -> notifications. Each test clears the company's notifications right
// before the action, then asserts the *complete* set of rows the action
// created: the expected user(s) and nobody else.
// ---------------------------------------------------------------------------

type Created = { userId: string; type: string; title: string; body: string; relatedEntityType: string | null; relatedEntityId: string | null };

async function clearNotifications(companyId: string) {
  await platformPrisma.notification.deleteMany({ where: { companyId } });
}

async function notificationsIn(companyId: string): Promise<Created[]> {
  return platformPrisma.notification.findMany({ where: { companyId }, orderBy: { userId: "asc" } });
}

async function userIdOf(employeeId: string) {
  return (await platformPrisma.user.findFirstOrThrow({ where: { employeeId } })).id;
}

/** Company with an admin, a manager, two active HR users, one deactivated
 * HR user, and an employee reporting to the manager.
 *
 * Login rate limit: 10 logins per company code per 15 min, and each
 * createEmployeeWithLogin uses 2 (temp password + real password). So users
 * that only *receive* notifications (hr2, hrGone) are created directly
 * with createTestUser, without logging in. */
async function setUpLeaveCompany(app: App) {
  const admin = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
  const code = admin.company.code;
  const manager = await createEmployeeWithLogin(app, admin.token, code, { firstName: "Manager", email: "m@example.test", role: "MANAGER" });
  const hr1 = await createEmployeeWithLogin(app, admin.token, code, { firstName: "HrOne", email: "hr1@example.test", role: "HR" });
  const hr2 = await createTestUser({ companyId: admin.company.id, role: "HR", email: "hr2@example.test", employeeCode: "HR-2" });
  await createTestUser({ companyId: admin.company.id, role: "HR", email: "hr3@example.test", employeeCode: "HR-3", status: "DEACTIVATED" });
  const employee = await createEmployeeWithLogin(app, admin.token, code, {
    firstName: "Emp",
    email: "e@example.test",
    managerId: manager.employee.id,
  });
  const annualId = await getLeaveTypeIdByCode(app, admin.token, "ANNUAL");
  return {
    admin,
    companyId: admin.company.id,
    annualId,
    manager: { ...manager, userId: await userIdOf(manager.employee.id) },
    hr1: { ...hr1, userId: await userIdOf(hr1.employee.id) },
    hr2: { userId: hr2.user.id },
    employee: { ...employee, userId: await userIdOf(employee.employee.id) },
  };
}

async function submitLeave(app: App, token: string, leaveTypeId: string, startDate = "2026-03-02", endDate = "2026-03-06") {
  const res = await request(app).post("/api/v1/leave-requests").set("Authorization", token).send({ leaveTypeId, startDate, endDate });
  expect(res.status).toBe(201);
  return res.body.leaveRequest.id as string;
}

describe("events write the right notification for the right user", () => {
  it("leave submitted (has a manager) -> only the manager, and they can read it via the API", async () => {
    const app = createApp();
    const c = await setUpLeaveCompany(app);
    await clearNotifications(c.companyId);

    const requestId = await submitLeave(app, c.employee.token, c.annualId);

    const rows = await notificationsIn(c.companyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: c.manager.userId,
      type: "LEAVE_REQUEST_SUBMITTED",
      relatedEntityType: "LeaveRequest",
      relatedEntityId: requestId,
    });
    expect(rows[0]!.body).toContain("Emp Test requested 5 day(s) of leave (02 Mar 2026 - 06 Mar 2026)");

    const list = await request(app).get("/api/v1/notifications").set("Authorization", c.manager.token);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].relatedEntityId).toBe(requestId);
  });

  it("leave submitted (no manager) -> every active HR user, not the deactivated one", async () => {
    const app = createApp();
    const c = await setUpLeaveCompany(app);
    const solo = await createEmployeeWithLogin(app, c.admin.token, c.admin.company.code, { firstName: "Solo", email: "solo@example.test" });
    await clearNotifications(c.companyId);

    await submitLeave(app, solo.token, c.annualId);

    const rows = await notificationsIn(c.companyId);
    expect(rows.map((r) => r.userId).sort()).toEqual([c.hr1.userId, c.hr2.userId].sort());
    expect(rows.every((r) => r.type === "LEAVE_REQUEST_SUBMITTED" && r.title === "New leave request awaiting HR approval")).toBe(true);
  });

  it("leave submitted by an HR user with no manager -> the other HR users, never the requester", async () => {
    const app = createApp();
    const c = await setUpLeaveCompany(app);
    await clearNotifications(c.companyId);

    await submitLeave(app, c.hr1.token, c.annualId);

    const rows = await notificationsIn(c.companyId);
    expect(rows.map((r) => r.userId)).toEqual([c.hr2.userId]);
  });

  it("leave submitted when the manager has no login -> HR instead (nobody would see it otherwise)", async () => {
    const app = createApp();
    const c = await setUpLeaveCompany(app);
    const noLoginManager = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", c.admin.token)
      .send({ firstName: "NoLogin", lastName: "Manager", joiningDate: "2020-01-01", createLogin: false });
    const report = await createEmployeeWithLogin(app, c.admin.token, c.admin.company.code, {
      firstName: "Report",
      email: "report@example.test",
      managerId: noLoginManager.body.employee.id,
    });
    await clearNotifications(c.companyId);

    await submitLeave(app, report.token, c.annualId);

    const rows = await notificationsIn(c.companyId);
    expect(rows.map((r) => r.userId).sort()).toEqual([c.hr1.userId, c.hr2.userId].sort());
  });

  it("MANAGER step approved under MANAGER_THEN_HR -> HR only; then HR approval -> the employee only", async () => {
    const app = createApp();
    const c = await setUpLeaveCompany(app);
    await request(app).patch("/api/v1/company/settings").set("Authorization", c.admin.token).send({ leaveApprovalWorkflow: "MANAGER_THEN_HR" });
    const requestId = await submitLeave(app, c.employee.token, c.annualId);

    await clearNotifications(c.companyId);
    const managerApprove = await request(app).patch(`/api/v1/leave-requests/${requestId}/approve`).set("Authorization", c.manager.token).send({});
    expect(managerApprove.status).toBe(200);

    let rows = await notificationsIn(c.companyId);
    expect(rows.map((r) => r.userId).sort()).toEqual([c.hr1.userId, c.hr2.userId].sort());
    expect(rows.every((r) => r.type === "LEAVE_REQUEST_PENDING_HR" && r.relatedEntityId === requestId)).toBe(true);
    expect(rows[0]!.body).toContain("Emp Test's 5-day leave");

    await clearNotifications(c.companyId);
    const hrApprove = await request(app).patch(`/api/v1/leave-requests/${requestId}/approve`).set("Authorization", c.hr1.token).send({});
    expect(hrApprove.status).toBe(200);

    rows = await notificationsIn(c.companyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: c.employee.userId,
      type: "LEAVE_REQUEST_APPROVED",
      title: "Your leave request was approved",
      relatedEntityType: "LeaveRequest",
      relatedEntityId: requestId,
    });
  });

  it("rejected -> the employee only, with the approver's note", async () => {
    const app = createApp();
    const c = await setUpLeaveCompany(app);
    const requestId = await submitLeave(app, c.employee.token, c.annualId);
    await clearNotifications(c.companyId);

    await request(app).patch(`/api/v1/leave-requests/${requestId}/reject`).set("Authorization", c.manager.token).send({ note: "Busy week" });

    const rows = await notificationsIn(c.companyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: c.employee.userId, type: "LEAVE_REQUEST_REJECTED", relatedEntityId: requestId });
    expect(rows[0]!.body).toContain('Note: "Busy week"');
  });

  it("revoked -> the employee only, with the note", async () => {
    const app = createApp();
    const c = await setUpLeaveCompany(app);
    const requestId = await submitLeave(app, c.employee.token, c.annualId);
    await request(app).patch(`/api/v1/leave-requests/${requestId}/approve`).set("Authorization", c.manager.token).send({});
    await clearNotifications(c.companyId);

    const revoke = await request(app)
      .patch(`/api/v1/leave-requests/${requestId}/revoke`)
      .set("Authorization", c.hr1.token)
      .send({ note: "Project deadline" });
    expect(revoke.status).toBe(200);

    const rows = await notificationsIn(c.companyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: c.employee.userId, type: "LEAVE_REQUEST_REVOKED", relatedEntityId: requestId });
    expect(rows[0]!.body).toContain('Note: "Project deadline"');
  });

  it("employee cancels at PENDING_MANAGER -> the manager only, not the employee", async () => {
    const app = createApp();
    const c = await setUpLeaveCompany(app);
    const requestId = await submitLeave(app, c.employee.token, c.annualId);
    await clearNotifications(c.companyId);

    const cancel = await request(app).patch(`/api/v1/leave-requests/${requestId}/cancel`).set("Authorization", c.employee.token).send({});
    expect(cancel.status).toBe(200);

    const rows = await notificationsIn(c.companyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: c.manager.userId,
      type: "LEAVE_REQUEST_CANCELLED",
      title: "Leave request cancelled",
      relatedEntityType: "LeaveRequest",
      relatedEntityId: requestId,
    });
    expect(rows[0]!.body).toContain("Emp Test cancelled their 5-day leave request");
  });

  it("employee cancels at PENDING_HR (after the manager step) -> active HR only, not the manager or employee", async () => {
    const app = createApp();
    const c = await setUpLeaveCompany(app);
    await request(app).patch("/api/v1/company/settings").set("Authorization", c.admin.token).send({ leaveApprovalWorkflow: "MANAGER_THEN_HR" });
    const requestId = await submitLeave(app, c.employee.token, c.annualId);
    await request(app).patch(`/api/v1/leave-requests/${requestId}/approve`).set("Authorization", c.manager.token).send({});
    await clearNotifications(c.companyId);

    const cancel = await request(app).patch(`/api/v1/leave-requests/${requestId}/cancel`).set("Authorization", c.employee.token).send({});
    expect(cancel.status).toBe(200);

    const rows = await notificationsIn(c.companyId);
    expect(rows.map((r) => r.userId).sort()).toEqual([c.hr1.userId, c.hr2.userId].sort());
    expect(rows.every((r) => r.type === "LEAVE_REQUEST_CANCELLED" && r.relatedEntityId === requestId)).toBe(true);
  });

  it("HR user cancels their own PENDING_HR request -> the other HR users, never themselves", async () => {
    const app = createApp();
    const c = await setUpLeaveCompany(app);
    const requestId = await submitLeave(app, c.hr1.token, c.annualId); // hr1 has no manager -> PENDING_HR
    await clearNotifications(c.companyId);

    await request(app).patch(`/api/v1/leave-requests/${requestId}/cancel`).set("Authorization", c.hr1.token).send({});

    const rows = await notificationsIn(c.companyId);
    expect(rows.map((r) => r.userId)).toEqual([c.hr2.userId]);
  });

  it("system cancels (employee deactivated) -> the employee only, once per pending request", async () => {
    const app = createApp();
    const c = await setUpLeaveCompany(app);
    const first = await submitLeave(app, c.employee.token, c.annualId, "2026-03-02", "2026-03-03");
    const second = await submitLeave(app, c.employee.token, c.annualId, "2026-04-06", "2026-04-06");
    await clearNotifications(c.companyId);

    const deactivate = await request(app)
      .patch(`/api/v1/employees/${c.employee.employee.id}/status`)
      .set("Authorization", c.admin.token)
      .send({ status: "INACTIVE" });
    expect(deactivate.status).toBe(200);

    const rows = await notificationsIn(c.companyId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === c.employee.userId && r.type === "LEAVE_REQUEST_CANCELLED")).toBe(true);
    expect(rows.map((r) => r.relatedEntityId).sort()).toEqual([first, second].sort());
    expect(rows[0]!.title).toBe("Your pending leave request was cancelled");
    expect(rows[0]!.body).toContain("because your employee profile was deactivated");
  });

  it.each([
    ["ACCEPTED", "Your sick leave document was accepted"],
    ["REJECTED", "Your sick leave document was rejected"],
    ["INFO_REQUIRED", "More information needed for your sick leave document"],
  ] as const)("document reviewed (%s) -> the employee only, with the HR note, linking to the leave request", async (status, title) => {
    const app = createApp();
    const c = await setUpLeaveCompany(app);
    const sickId = await getLeaveTypeIdByCode(app, c.admin.token, "SICK");
    const requestId = await submitLeave(app, c.employee.token, sickId, "2026-03-02", "2026-03-02");
    const upload = await request(app)
      .post(`/api/v1/leave-requests/${requestId}/documents`)
      .set("Authorization", c.employee.token)
      .attach("file", Buffer.from("%PDF-1.4\n%fake pdf content for testing purposes only\n"), {
        filename: "proof.pdf",
        contentType: "application/pdf",
      });
    expect(upload.status).toBe(201);
    await clearNotifications(c.companyId);

    const review = await request(app)
      .patch(`/api/v1/leave-requests/${requestId}/documents/${upload.body.document.id}/review`)
      .set("Authorization", c.hr1.token)
      .send({ status, note: "Please include the doctor's stamp" });
    expect(review.status).toBe(200);

    const rows = await notificationsIn(c.companyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: c.employee.userId,
      type: "LEAVE_DOCUMENT_REVIEWED",
      title,
      relatedEntityType: "LeaveRequest",
      relatedEntityId: requestId,
    });
    expect(rows[0]!.body).toContain(`HR note: "Please include the doctor's stamp"`);
  });
});
