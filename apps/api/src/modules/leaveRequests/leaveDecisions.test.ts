import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createEmployeeWithLogin, getLeaveTypeIdByCode, setUpCompanyWithUser } from "../../test/helpers.js";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

async function getBalance(app: ReturnType<typeof createApp>, adminToken: string, employeeId: string, leaveTypeId: string) {
  const res = await request(app).get(`/api/v1/employees/${employeeId}/leave-balances`).set("Authorization", adminToken);
  return res.body.data.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId);
}

describe("MANAGER_ONLY workflow (default)", () => {
  it("manager approval is final: pending -> used", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { employee: manager, token: managerToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Manager",
      email: "manager@example.test",
      role: "MANAGER",
    });
    const { employee, token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Employee",
      email: "employee@example.test",
      managerId: manager.id,
    });
    const leaveTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-06" }); // 5 days
    const requestId = createRes.body.leaveRequest.id;

    const beforeBalance = await getBalance(app, adminToken, employee.id, leaveTypeId);
    expect(beforeBalance.pendingDays).toBe(5);
    expect(beforeBalance.usedDays).toBe(0);

    const approveRes = await request(app)
      .patch(`/api/v1/leave-requests/${requestId}/approve`)
      .set("Authorization", managerToken)
      .send({});
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.leaveRequest.status).toBe("APPROVED");

    const afterBalance = await getBalance(app, adminToken, employee.id, leaveTypeId);
    expect(afterBalance.pendingDays).toBe(0);
    expect(afterBalance.usedDays).toBe(5);
  });

  it("rejection releases pendingDays without touching usedDays", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { employee: manager, token: managerToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Manager",
      email: "manager@example.test",
      role: "MANAGER",
    });
    const { employee, token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Employee",
      email: "employee@example.test",
      managerId: manager.id,
    });
    const leaveTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-06" });

    await request(app)
      .patch(`/api/v1/leave-requests/${createRes.body.leaveRequest.id}/reject`)
      .set("Authorization", managerToken)
      .send({ note: "Not enough coverage that week" });

    const balance = await getBalance(app, adminToken, employee.id, leaveTypeId);
    expect(balance.pendingDays).toBe(0);
    expect(balance.usedDays).toBe(0);
  });

  it("the employee cancelling their own pending request releases pendingDays", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { employee, token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-03" });

    const cancelRes = await request(app)
      .patch(`/api/v1/leave-requests/${createRes.body.leaveRequest.id}/cancel`)
      .set("Authorization", employeeToken);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.leaveRequest.status).toBe("CANCELLED");

    const balance = await getBalance(app, adminToken, employee.id, leaveTypeId);
    expect(balance.pendingDays).toBe(0);
  });

  it("blocks self-approval: HR cannot approve their own leave request", async () => {
    // An employee can never be their own manager (enforced in the
    // employees module), so self-approval can only actually be reached via
    // HR, who decides at both the MANAGER-fallback and HR steps.
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: hrToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "HR",
      email: "hr@example.test",
      role: "HR",
    });
    const leaveTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", hrToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-02" });
    expect(createRes.body.leaveRequest.status).toBe("PENDING_HR");

    const res = await request(app)
      .patch(`/api/v1/leave-requests/${createRes.body.leaveRequest.id}/approve`)
      .set("Authorization", hrToken)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CANNOT_DECIDE_OWN_REQUEST");
  });

  it("a step cannot be decided twice", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { employee: manager, token: managerToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Manager",
      email: "manager@example.test",
      role: "MANAGER",
    });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Employee",
      email: "employee@example.test",
      managerId: manager.id,
    });
    const leaveTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-02" });
    const requestId = createRes.body.leaveRequest.id;

    await request(app).patch(`/api/v1/leave-requests/${requestId}/approve`).set("Authorization", managerToken).send({});

    const secondAttempt = await request(app)
      .patch(`/api/v1/leave-requests/${requestId}/reject`)
      .set("Authorization", managerToken)
      .send({});
    expect(secondAttempt.status).toBe(409);
    expect(secondAttempt.body.error.code).toBe("ALREADY_DECIDED");
  });
});

describe("MANAGER_THEN_HR workflow", () => {
  async function setWorkflow(app: ReturnType<typeof createApp>, adminToken: string) {
    await request(app)
      .patch("/api/v1/company/settings")
      .set("Authorization", adminToken)
      .send({ leaveApprovalWorkflow: "MANAGER_THEN_HR" });
  }

  it("manager approval advances to PENDING_HR; HR approval is then final", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    await setWorkflow(app, adminToken);
    const { employee: manager, token: managerToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Manager",
      email: "manager@example.test",
      role: "MANAGER",
    });
    const { token: hrToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "HR",
      email: "hr@example.test",
      role: "HR",
    });
    const { employee, token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Employee",
      email: "employee@example.test",
      managerId: manager.id,
    });
    const leaveTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-03" });
    const requestId = createRes.body.leaveRequest.id;

    const managerApproveRes = await request(app)
      .patch(`/api/v1/leave-requests/${requestId}/approve`)
      .set("Authorization", managerToken)
      .send({});
    expect(managerApproveRes.body.leaveRequest.status).toBe("PENDING_HR");

    const midBalance = await getBalance(app, adminToken, employee.id, leaveTypeId);
    expect(midBalance.pendingDays).toBe(2); // still reserved, not yet used

    const hrApproveRes = await request(app)
      .patch(`/api/v1/leave-requests/${requestId}/approve`)
      .set("Authorization", hrToken)
      .send({});
    expect(hrApproveRes.body.leaveRequest.status).toBe("APPROVED");

    const finalBalance = await getBalance(app, adminToken, employee.id, leaveTypeId);
    expect(finalBalance.pendingDays).toBe(0);
    expect(finalBalance.usedDays).toBe(2);
  });

  it("HR fallback approval at the MANAGER step is final - does not advance to PENDING_HR", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    await setWorkflow(app, adminToken);
    const { employee: manager } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Manager",
      email: "manager@example.test",
      role: "MANAGER",
    });
    const { token: hrToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "HR",
      email: "hr@example.test",
      role: "HR",
    });
    const { employee, token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Employee",
      email: "employee@example.test",
      managerId: manager.id,
    });
    const leaveTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-02" });
    expect(createRes.body.leaveRequest.status).toBe("PENDING_MANAGER");

    // HR steps in while the manager hasn't decided yet
    const hrFallbackRes = await request(app)
      .patch(`/api/v1/leave-requests/${createRes.body.leaveRequest.id}/approve`)
      .set("Authorization", hrToken)
      .send({});
    expect(hrFallbackRes.body.leaveRequest.status).toBe("APPROVED");

    const balance = await getBalance(app, adminToken, employee.id, leaveTypeId);
    expect(balance.pendingDays).toBe(0);
    expect(balance.usedDays).toBe(1);
  });

  it("an employee with no manager goes straight to PENDING_HR and HR approval is final", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    await setWorkflow(app, adminToken);
    const { token: hrToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "HR",
      email: "hr@example.test",
      role: "HR",
    });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-02" });
    expect(createRes.body.leaveRequest.status).toBe("PENDING_HR");

    const res = await request(app)
      .patch(`/api/v1/leave-requests/${createRes.body.leaveRequest.id}/approve`)
      .set("Authorization", hrToken)
      .send({});
    expect(res.body.leaveRequest.status).toBe("APPROVED");
  });

  it("a MANAGER cannot decide at the HR step", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    await setWorkflow(app, adminToken);
    const { employee: manager, token: managerToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Manager",
      email: "manager@example.test",
      role: "MANAGER",
    });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Employee",
      email: "employee@example.test",
      managerId: manager.id,
    });
    const leaveTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-02" });
    const requestId = createRes.body.leaveRequest.id;

    await request(app).patch(`/api/v1/leave-requests/${requestId}/approve`).set("Authorization", managerToken).send({});

    const res = await request(app)
      .patch(`/api/v1/leave-requests/${requestId}/approve`)
      .set("Authorization", managerToken)
      .send({});
    expect([403, 404, 409]).toContain(res.status);
  });
});

describe("PATCH /api/v1/leave-requests/:id/revoke", () => {
  it("decrements usedDays only (not pendingDays) for a future approved request", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { employee: manager, token: managerToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Manager",
      email: "manager@example.test",
      role: "MANAGER",
    });
    const { employee, token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Employee",
      email: "employee@example.test",
      managerId: manager.id,
    });
    const leaveTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-03" });
    const requestId = createRes.body.leaveRequest.id;
    await request(app).patch(`/api/v1/leave-requests/${requestId}/approve`).set("Authorization", managerToken).send({});

    const revokeRes = await request(app)
      .patch(`/api/v1/leave-requests/${requestId}/revoke`)
      .set("Authorization", adminToken)
      .send({ note: "Plans changed" });
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.leaveRequest.status).toBe("REVOKED");

    const balance = await getBalance(app, adminToken, employee.id, leaveTypeId);
    expect(balance.usedDays).toBe(0);
    expect(balance.pendingDays).toBe(0);
  });

  it("rejects revoking a request that already started", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: hrToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "HR",
      email: "hr@example.test",
      role: "HR",
    });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const typesRes = await request(app).get("/api/v1/leave-types").set("Authorization", adminToken);
    const sickTypeId = typesRes.body.data.find((t: { code: string }) => t.code === "SICK").id;

    // today (frozen) is 2026-01-15
    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId: sickTypeId, startDate: "2026-01-15", endDate: "2026-01-15" });
    await request(app)
      .patch(`/api/v1/leave-requests/${createRes.body.leaveRequest.id}/approve`)
      .set("Authorization", hrToken)
      .send({});

    const res = await request(app)
      .patch(`/api/v1/leave-requests/${createRes.body.leaveRequest.id}/revoke`)
      .set("Authorization", adminToken)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_REVOCABLE");
  });

  it("rejects revoking a request that isn't APPROVED", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-02" });

    const res = await request(app)
      .patch(`/api/v1/leave-requests/${createRes.body.leaveRequest.id}/revoke`)
      .set("Authorization", adminToken)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_REVOCABLE");
  });
});

describe("cross-tenant isolation for decisions", () => {
  it("company B's HR gets 404 trying to approve company A's leave request", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: otherHrToken } = await setUpCompanyWithUser(app, { role: "HR", employeeCode: "HR-001" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveTypeId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

    const createRes = await request(app)
      .post("/api/v1/leave-requests")
      .set("Authorization", employeeToken)
      .send({ leaveTypeId, startDate: "2026-03-02", endDate: "2026-03-02" });

    const res = await request(app)
      .patch(`/api/v1/leave-requests/${createRes.body.leaveRequest.id}/approve`)
      .set("Authorization", otherHrToken)
      .send({});
    expect(res.status).toBe(404);
  });
});
