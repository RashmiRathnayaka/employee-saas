import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { bearerFor, loginAs, setUpCompanyWithUser } from "../../test/helpers.js";

describe("employees module", () => {
  it("MANAGER cannot create employees", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "MANAGER", employeeCode: "EMP-001" });

    const res = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "New", lastName: "Hire", joiningDate: "2026-01-01" });

    expect(res.status).toBe(403);
  });

  it("exposes userId for the linked login account, and null when there is none", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const withLoginRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({
        firstName: "Has",
        lastName: "Login",
        joiningDate: "2026-01-01",
        createLogin: true,
        loginEmail: "has-login@example.test",
      });
    expect(withLoginRes.body.employee.userId).toBe(withLoginRes.body.login.user.id);

    const withoutLoginRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "No", lastName: "Login", joiningDate: "2026-01-01" });
    expect(withoutLoginRes.body.employee.userId).toBeNull();
    expect(withoutLoginRes.body.login).toBeNull();

    const getRes = await request(app)
      .get(`/api/v1/employees/${withLoginRes.body.employee.id}`)
      .set("Authorization", token);
    expect(getRes.body.employee.userId).toBe(withLoginRes.body.login.user.id);
  });

  it("EMPLOYEE cannot list employees", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "EMPLOYEE", employeeCode: "EMP-001" });

    const res = await request(app).get("/api/v1/employees").set("Authorization", token);
    expect(res.status).toBe(403);
  });

  it("cross-tenant: company B gets 404 for company A's employee (read, update)", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: otherToken } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const createRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "Alex", lastName: "Employee", joiningDate: "2026-01-01" });
    const employeeId = createRes.body.employee.id;

    const readRes = await request(app).get(`/api/v1/employees/${employeeId}`).set("Authorization", otherToken);
    expect(readRes.status).toBe(404);

    const updateRes = await request(app)
      .patch(`/api/v1/employees/${employeeId}`)
      .set("Authorization", otherToken)
      .send({ firstName: "Hacked" });
    expect(updateRes.status).toBe(404);
  });

  it("generates sequential, unique employee codes under concurrent creates", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const creates = Array.from({ length: 8 }, (_, i) =>
      request(app)
        .post("/api/v1/employees")
        .set("Authorization", token)
        .send({ firstName: `Worker${i}`, lastName: "Concurrent", joiningDate: "2026-01-01" }),
    );
    const results = await Promise.all(creates);

    for (const res of results) {
      expect(res.status).toBe(201);
    }
    const codes = results.map((r) => r.body.employee.employeeCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("creates leave balances for every leave type on employee creation", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const res = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "Jamie", lastName: "New", joiningDate: "2026-01-01" });

    const { platformPrisma } = await import("../../lib/prisma.js");
    const balances = await platformPrisma.leaveBalance.findMany({ where: { employeeId: res.body.employee.id } });
    expect(balances).toHaveLength(3);
  });

  it("rejects an employee being set as their own manager", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const createRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "Solo", lastName: "Worker", joiningDate: "2026-01-01" });
    const employeeId = createRes.body.employee.id;

    const res = await request(app)
      .patch(`/api/v1/employees/${employeeId}`)
      .set("Authorization", token)
      .send({ managerId: employeeId });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_MANAGER");
  });

  it("rejects a manager assignment that would create a reporting cycle", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const aRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "A", lastName: "Person", joiningDate: "2026-01-01" });
    const aId = aRes.body.employee.id;

    const bRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "B", lastName: "Person", joiningDate: "2026-01-01", managerId: aId });
    const bId = bRes.body.employee.id;

    // A reports to B would close the loop A -> B -> A
    const cycleRes = await request(app)
      .patch(`/api/v1/employees/${aId}`)
      .set("Authorization", token)
      .send({ managerId: bId });

    expect(cycleRes.status).toBe(400);
    expect(cycleRes.body.error.code).toBe("MANAGER_CYCLE");
  });

  it("MANAGER sees only their direct reports in the employee list", async () => {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const managerRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({
        firstName: "Morgan",
        lastName: "Manager",
        joiningDate: "2026-01-01",
        createLogin: true,
        loginEmail: "morgan@example.test",
        loginRole: "MANAGER",
      });
    const managerId = managerRes.body.employee.id;
    const managerTempPassword = managerRes.body.login.temporaryPassword;

    await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "Report", lastName: "One", joiningDate: "2026-01-01", managerId });
    await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "Report", lastName: "Two", joiningDate: "2026-01-01", managerId });
    await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "Unrelated", lastName: "Person", joiningDate: "2026-01-01" });

    // the manager must change their temp password before doing anything else
    const managerLogin = await loginAs(app, {
      companyCode: company.code,
      identifier: "morgan@example.test",
      password: managerTempPassword,
      clientType: "mobile",
    });
    await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${managerLogin.body.accessToken}`)
      .send({ currentPassword: managerTempPassword, newPassword: "NewPassw0rd!" });

    const managerToken = await bearerFor(app, {
      companyCode: company.code,
      identifier: "morgan@example.test",
      password: "NewPassw0rd!",
    });

    const listRes = await request(app).get("/api/v1/employees").set("Authorization", managerToken);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(2);
    expect(listRes.body.data.map((e: { lastName: string }) => e.lastName).sort()).toEqual(["One", "Two"]);
  });

  it("deactivating an employee deactivates their login and revokes their refresh tokens", async () => {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const createRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({
        firstName: "Soon",
        lastName: "Gone",
        joiningDate: "2026-01-01",
        createLogin: true,
        loginEmail: "soon-gone@example.test",
        loginRole: "EMPLOYEE",
      });
    const employeeId = createRes.body.employee.id;
    const tempPassword = createRes.body.login.temporaryPassword;

    const loginRes = await loginAs(app, {
      companyCode: company.code,
      identifier: "soon-gone@example.test",
      password: tempPassword,
      clientType: "mobile",
    });
    const refreshToken = loginRes.body.refreshToken;

    const deactivateRes = await request(app)
      .patch(`/api/v1/employees/${employeeId}/status`)
      .set("Authorization", token)
      .send({ status: "INACTIVE" });
    expect(deactivateRes.status).toBe(200);

    const loginAfter = await loginAs(app, {
      companyCode: company.code,
      identifier: "soon-gone@example.test",
      password: tempPassword,
      clientType: "mobile",
    });
    expect(loginAfter.status).toBe(401);

    const refreshAfter = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client", "mobile")
      .send({ refreshToken });
    expect(refreshAfter.status).toBe(401);
  });

  it("mustChangePassword blocks other endpoints until the password is changed", async () => {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const createRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({
        firstName: "Brand",
        lastName: "New",
        joiningDate: "2026-01-01",
        createLogin: true,
        loginEmail: "brand-new@example.test",
        loginRole: "EMPLOYEE",
      });
    expect(createRes.body.login.user.passwordHash).toBeUndefined();
    const tempPassword = createRes.body.login.temporaryPassword;

    const loginRes = await loginAs(app, {
      companyCode: company.code,
      identifier: "brand-new@example.test",
      password: tempPassword,
      clientType: "mobile",
    });
    expect(loginRes.body.user.mustChangePassword).toBe(true);
    const newAccessToken = `Bearer ${loginRes.body.accessToken}`;

    const blockedRes = await request(app).get("/api/v1/employees/me").set("Authorization", newAccessToken);
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const changeRes = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", newAccessToken)
      .send({ currentPassword: tempPassword, newPassword: "BrandNewPassw0rd!" });
    expect(changeRes.status).toBe(200);

    const allowedRes = await request(app).get("/api/v1/employees/me").set("Authorization", newAccessToken);
    expect(allowedRes.status).toBe(200);
  });

  it("last-admin protection also applies when the admin was promoted from an employee login", async () => {
    const app = createApp();
    const { token: adminAToken, company, user: adminA } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const empRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", adminAToken)
      .send({
        firstName: "Promoted",
        lastName: "Admin",
        joiningDate: "2026-01-01",
        createLogin: true,
        loginEmail: "promoted@example.test",
        loginRole: "MANAGER",
      });
    const employeeId = empRes.body.employee.id;
    const promotedUserId = empRes.body.login.user.id;
    const tempPassword = empRes.body.login.temporaryPassword;

    // promoted user must change password before they can be used as an actor later, but
    // admin A can promote them regardless of that flag (admin A isn't the one blocked)
    await request(app)
      .patch(`/api/v1/users/${promotedUserId}`)
      .set("Authorization", adminAToken)
      .send({ role: "COMPANY_ADMIN" });

    // deactivate admin A, leaving the promoted employee as the sole active admin
    await request(app)
      .patch(`/api/v1/users/${adminA.id}/status`)
      .set("Authorization", adminAToken)
      .send({ status: "DEACTIVATED" });
    // that call should actually fail since A would be deactivating themselves while
    // still being needed - but here a *second* admin (the promoted one) exists, so it's allowed.

    // log in as the promoted admin and change their temp password first
    const promotedLogin = await loginAs(app, {
      companyCode: company.code,
      identifier: "promoted@example.test",
      password: tempPassword,
      clientType: "mobile",
    });
    await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${promotedLogin.body.accessToken}`)
      .send({ currentPassword: tempPassword, newPassword: "PromotedPassw0rd!" });
    const promotedToken = await bearerFor(app, {
      companyCode: company.code,
      identifier: "promoted@example.test",
      password: "PromotedPassw0rd!",
    });

    // now the promoted admin is the ONLY active admin - deactivating their employee
    // record (not their user record) must still be blocked by the same invariant
    const res = await request(app)
      .patch(`/api/v1/employees/${employeeId}/status`)
      .set("Authorization", promotedToken)
      .send({ status: "INACTIVE" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CANNOT_MODIFY_SELF");
  });

  it("deactivating an employee cancels their pending leave requests and releases pendingDays", async () => {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const empRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({
        firstName: "Soon",
        lastName: "Deactivated",
        joiningDate: "2026-01-01",
        createLogin: true,
        loginEmail: "soon-deactivated@example.test",
        loginRole: "EMPLOYEE",
      });
    const employeeId = empRes.body.employee.id;
    const tempPassword = empRes.body.login.temporaryPassword;

    const loginRes = await loginAs(app, {
      companyCode: company.code,
      identifier: "soon-deactivated@example.test",
      password: tempPassword,
      clientType: "mobile",
    });
    await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .send({ currentPassword: tempPassword, newPassword: "DeactivatedPassw0rd!1" });
    const employeeToken = await bearerFor(app, {
      companyCode: company.code,
      identifier: "soon-deactivated@example.test",
      password: "DeactivatedPassw0rd!1",
    });

    const typesRes = await request(app).get("/api/v1/leave-types").set("Authorization", token);
    const annual = typesRes.body.data.find((t: { code: string }) => t.code === "ANNUAL");

    // a safely-future 8-day span guarantees at least some working days,
    // whatever day of the week "today" happens to be when this test runs
    let start = new Date();
    start.setUTCDate(start.getUTCDate() + 10);
    let end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    if (start.getUTCFullYear() !== end.getUTCFullYear()) {
      // avoid the rare case of this span crossing into next year (a
      // single leave request must stay within one calendar year) - jump
      // well into next year instead, still safely future either way
      start = new Date(Date.UTC(end.getUTCFullYear(), 1, 10));
      end = new Date(Date.UTC(end.getUTCFullYear(), 1, 17));
    }
    const toIso = (d: Date) => d.toISOString().slice(0, 10);

    const leaveRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId: annual.id, startDate: toIso(start), endDate: toIso(end) });
    expect(leaveRes.status).toBe(201);
    const totalDays = leaveRes.body.leaveRequest.totalDays;
    expect(totalDays).toBeGreaterThan(0);

    const balanceBefore = await request(app)
      .get(`/api/v1/employees/${employeeId}/leave-balances`)
      .set("Authorization", token);
    const annualBalanceBefore = balanceBefore.body.data.find((b: { leaveTypeId: string }) => b.leaveTypeId === annual.id);
    expect(annualBalanceBefore.pendingDays).toBe(totalDays);

    const deactivateRes = await request(app)
      .patch(`/api/v1/employees/${employeeId}/status`)
      .set("Authorization", token)
      .send({ status: "INACTIVE" });
    expect(deactivateRes.status).toBe(200);

    const leaveAfter = await request(app)
      .get(`/api/v1/leave-requests/${leaveRes.body.leaveRequest.id}`)
      .set("Authorization", token);
    expect(leaveAfter.body.leaveRequest.status).toBe("CANCELLED");

    const balanceAfter = await request(app)
      .get(`/api/v1/employees/${employeeId}/leave-balances`)
      .set("Authorization", token);
    const annualBalanceAfter = balanceAfter.body.data.find((b: { leaveTypeId: string }) => b.leaveTypeId === annual.id);
    expect(annualBalanceAfter.pendingDays).toBe(0);
  });
});
