import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createEmployeeWithLogin, getLeaveTypeIdByCode, setUpCompanyWithUser } from "../../test/helpers.js";

// Dates below (e.g. "2026-03-02", a Monday) are fixed test fixtures, so
// "today" is frozen well before them - only the Date object is faked
// (setTimeout/network/etc. stay real), so this can't hang anything.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

async function getAnnualLeaveTypeId(app: ReturnType<typeof createApp>, token: string) {
  return getLeaveTypeIdByCode(app, token, "ANNUAL");
}

describe("POST /api/v1/leave-requests", () => {
  it("routes to PENDING_MANAGER when the employee has a manager, and computes totalDays correctly", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { employee: manager } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Manager",
      email: "manager@example.test",
      role: "MANAGER",
    });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Employee",
      email: "employee@example.test",
      managerId: manager.id,
    });
    const leaveTypeId = await getAnnualLeaveTypeId(app, adminToken);

    const res = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-06" }); // Mon-Fri

    expect(res.status).toBe(201);
    expect(res.body.leaveRequest.status).toBe("PENDING_MANAGER");
    expect(res.body.leaveRequest.totalDays).toBe(5);
  });

  it("routes to PENDING_HR when the employee has no manager", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveTypeId = await getAnnualLeaveTypeId(app, adminToken);

    const res = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-02" });

    expect(res.status).toBe(201);
    expect(res.body.leaveRequest.status).toBe("PENDING_HR");
  });

  it("rejects a request exceeding the available balance", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveTypeId = await getAnnualLeaveTypeId(app, adminToken); // 14 days allocated

    const res = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      // 3 full weeks = 15 working days, more than the 14 allocated
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-20" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("two concurrent submissions cannot together overspend the balance", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveTypeId = await getAnnualLeaveTypeId(app, adminToken); // 14 days allocated

    // two separate 10-day requests (non-overlapping date ranges) - together
    // 20 days, more than the 14 available, so at most one can succeed.
    const [a, b] = await Promise.all([
      request(app)
        .post("/api/v1/leave-requests")
        .set("Authorization", employeeToken)
        .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-13" }),
      request(app)
        .post("/api/v1/leave-requests")
        .set("Authorization", employeeToken)
        .send({ leaveTypeId, startDate: "2026-04-01", endDate: "2026-04-12" }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it("rejects an overlapping request against an existing pending request", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveTypeId = await getAnnualLeaveTypeId(app, adminToken);

    await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-04" });

    const res = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-03", endDate: "2026-03-05" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LEAVE_OVERLAP");
  });

  it("rejects a request that crosses a calendar year boundary", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveTypeId = await getAnnualLeaveTypeId(app, adminToken);

    const res = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-12-30", endDate: "2027-01-02" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LEAVE_RANGE");
  });

  it("rejects a past-dated request for a leave type that doesn't allow past dates", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveTypeId = await getAnnualLeaveTypeId(app, adminToken);

    const res = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2020-01-02", endDate: "2020-01-02" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAST_DATE_NOT_ALLOWED");
  });

  it("allows a past-dated sick leave request within 30 days, rejects one older than that", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const typesRes = await request(app).get("/api/v1/leave-types").set("Authorization", adminToken);
    const sickTypeId = typesRes.body.data.find((t: { code: string }) => t.code === "SICK").id;

    const today = new Date();
    const tenDaysAgo = new Date(today.getTime() - 10 * 86_400_000).toISOString().slice(0, 10);
    const fortyDaysAgo = new Date(today.getTime() - 40 * 86_400_000).toISOString().slice(0, 10);

    const recentRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId: sickTypeId, startDate: tenDaysAgo, endDate: tenDaysAgo });
    expect(recentRes.status).toBe(201);

    const tooOldRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId: sickTypeId, startDate: fortyDaysAgo, endDate: fortyDaysAgo });
    expect(tooOldRes.status).toBe(400);
    expect(tooOldRes.body.error.code).toBe("PAST_DATE_TOO_OLD");
  });
});

describe("GET /api/v1/leave-requests/:id", () => {
  it("cross-tenant: company B gets 404 for company A's leave request", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: otherToken } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveTypeId = await getAnnualLeaveTypeId(app, adminToken);

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-02" });

    const res = await request(app)
      .get(`/api/v1/leave-requests/${createRes.body.leaveRequest.id}`)
      .set("Authorization", otherToken);
    expect(res.status).toBe(404);
  });
});

describe("employeeId filter on /leave-requests and /leave-requests/team", () => {
  it("HR's company-wide list, filtered to one employee, returns only that employee's requests", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: hrToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "HR",
      email: "hr@example.test",
      role: "HR",
    });
    const { employee: employeeA, token: tokenA } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "A",
      email: "a@example.test",
    });
    const { token: tokenB } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "B",
      email: "b@example.test",
    });
    const leaveTypeId = await getAnnualLeaveTypeId(app, adminToken);

    await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", tokenA)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-02" });
    await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", tokenB)
      .send({ leaveTypeId, startDate: "2026-03-03", endDate: "2026-03-03" });

    const res = await request(app)
      .get(`/api/v1/leave-requests?employeeId=${employeeA.id}`)
      .set("Authorization", hrToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].employeeId).toBe(employeeA.id);
  });

  it("a manager filtering their team list by employeeId cannot see an employee outside their team", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: managerToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Manager",
      email: "manager@example.test",
      role: "MANAGER",
    });
    const { employee: outsider, token: outsiderToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Outsider",
      email: "outsider@example.test",
    });
    const leaveTypeId = await getAnnualLeaveTypeId(app, adminToken);

    await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", outsiderToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-02" });

    const res = await request(app)
      .get(`/api/v1/leave-requests/team?employeeId=${outsider.id}`)
      .set("Authorization", managerToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});
