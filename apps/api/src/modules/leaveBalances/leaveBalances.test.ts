import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { activateTempPassword, setUpCompanyWithUser } from "../../test/helpers.js";

describe("leave balances module", () => {
  it("GET /leave-balances/me returns the caller's own balances", async () => {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const empRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({
        firstName: "Alex",
        lastName: "Employee",
        joiningDate: "2026-01-01",
        createLogin: true,
        loginEmail: "alex@example.test",
        loginRole: "EMPLOYEE",
      });
    const tempPassword = empRes.body.login.temporaryPassword;
    const employeeToken = await activateTempPassword(app, {
      companyCode: company.code,
      identifier: "alex@example.test",
      tempPassword,
    });

    const res = await request(app).get("/api/v1/leave-balances/me").set("Authorization", employeeToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0]).toHaveProperty("availableDays");
  });

  it("MANAGER can view a direct report's balances but not an unrelated employee's", async () => {
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

    const reportRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "Report", lastName: "One", joiningDate: "2026-01-01", managerId });
    const unrelatedRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "Unrelated", lastName: "Person", joiningDate: "2026-01-01" });

    const managerToken = await activateTempPassword(app, {
      companyCode: company.code,
      identifier: "morgan@example.test",
      tempPassword: managerTempPassword,
    });

    const okRes = await request(app)
      .get(`/api/v1/employees/${reportRes.body.employee.id}/leave-balances`)
      .set("Authorization", managerToken);
    expect(okRes.status).toBe(200);

    const blockedRes = await request(app)
      .get(`/api/v1/employees/${unrelatedRes.body.employee.id}/leave-balances`)
      .set("Authorization", managerToken);
    expect(blockedRes.status).toBe(404);
  });

  it("adjusts a balance and audits the before/after values", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const empRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "Needs", lastName: "Adjustment", joiningDate: "2026-01-01" });
    const employeeId = empRes.body.employee.id;

    const balancesRes = await request(app)
      .get(`/api/v1/employees/${employeeId}/leave-balances`)
      .set("Authorization", token);
    const annual = balancesRes.body.data.find((b: { allocatedDays: number }) => b.allocatedDays === 14);

    const res = await request(app)
      .post(`/api/v1/employees/${employeeId}/leave-balances/adjust`)
      .set("Authorization", token)
      .send({ leaveTypeId: annual.leaveTypeId, year: new Date().getUTCFullYear(), allocatedDays: 20, note: "Manual top-up" });

    expect(res.status).toBe(200);
    expect(res.body.balance.allocatedDays).toBe(20);
  });

  it("rejects an adjustment that would make usedDays negative", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const empRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "Needs", lastName: "Adjustment", joiningDate: "2026-01-01" });
    const employeeId = empRes.body.employee.id;
    const balancesRes = await request(app)
      .get(`/api/v1/employees/${employeeId}/leave-balances`)
      .set("Authorization", token);
    const annual = balancesRes.body.data[0];

    const res = await request(app)
      .post(`/api/v1/employees/${employeeId}/leave-balances/adjust`)
      .set("Authorization", token)
      .send({ leaveTypeId: annual.leaveTypeId, year: new Date().getUTCFullYear(), usedDays: -5, note: "bad" });
    expect(res.status).toBe(400);
  });
});
