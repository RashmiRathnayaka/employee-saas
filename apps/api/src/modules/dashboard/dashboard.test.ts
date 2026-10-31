import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createEmployeeWithLogin, getLeaveTypeIdByCode, setUpCompanyWithUser } from "../../test/helpers.js";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

describe("GET /api/v1/dashboard/summary", () => {
  it("EMPLOYEE is forbidden", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });

    const res = await request(app).get("/api/v1/dashboard/summary").set("Authorization", employeeToken);
    expect(res.status).toBe(403);
  });

  it("COMPANY_ADMIN/HR get company-wide counts, scoped to their own company only", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: otherAdminToken, company: otherCompany } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const annualTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");
    const sickTypeId = await getLeaveTypeIdByCode(app, adminToken, "SICK");

    const { token: employeeAToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "A",
      email: "a@example.test",
    });
    const { token: employeeBToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "B",
      email: "b@example.test",
    });

    // A: pending request (not yet decided).
    await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeAToken)
      .send({ leaveTypeId: annualTypeId, startDate: "2026-07-01", endDate: "2026-07-01" });

    // B: sick leave submitted today, proof not yet uploaded -> MISSING.
    await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeBToken)
      .send({ leaveTypeId: sickTypeId, startDate: "2026-06-15", endDate: "2026-06-15" });

    // Noise in a different company - must not leak into this company's counts.
    const { token: otherEmployeeToken } = await createEmployeeWithLogin(app, otherAdminToken, otherCompany.code, {
      firstName: "Other",
      email: "other@example.test",
    });
    const otherAnnualTypeId = await getLeaveTypeIdByCode(app, otherAdminToken, "ANNUAL");
    await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", otherEmployeeToken)
      .send({ leaveTypeId: otherAnnualTypeId, startDate: "2026-07-01", endDate: "2026-07-01" });

    const res = await request(app).get("/api/v1/dashboard/summary").set("Authorization", adminToken);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      scope: "ADMIN",
      activeEmployees: 2,
      pendingLeaveRequests: 2,
      proofsOverdue: 1,
    });

    const otherRes = await request(app).get("/api/v1/dashboard/summary").set("Authorization", otherAdminToken);
    expect(otherRes.body).toMatchObject({ scope: "ADMIN", activeEmployees: 1, pendingLeaveRequests: 1 });
  });

  it("MANAGER gets counts scoped to their own direct reports only, not the whole company", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { employee: manager, token: managerToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Manager",
      email: "manager@example.test",
      role: "MANAGER",
    });
    const { token: reportToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Report",
      email: "report@example.test",
      managerId: manager.id,
    });
    const { token: outsiderToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Outsider",
      email: "outsider@example.test",
    });
    const annualTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    // Direct report: pending request.
    await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", reportToken)
      .send({ leaveTypeId: annualTypeId, startDate: "2026-07-01", endDate: "2026-07-01" });

    // Outsider (not on this manager's team): also pending - must not count.
    await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", outsiderToken)
      .send({ leaveTypeId: annualTypeId, startDate: "2026-07-02", endDate: "2026-07-02" });

    const res = await request(app).get("/api/v1/dashboard/summary").set("Authorization", managerToken);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scope: "MANAGER", teamPendingRequests: 1, teamOnLeaveToday: 0 });
  });
});
