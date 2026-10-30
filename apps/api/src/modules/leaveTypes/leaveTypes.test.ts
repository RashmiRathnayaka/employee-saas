import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { setUpCompanyWithUser } from "../../test/helpers.js";
import { platformPrisma } from "../../lib/prisma.js";

describe("leave types module", () => {
  it("creating a leave type seeds current-year balances for every active employee", async () => {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "A", lastName: "One", joiningDate: "2026-01-01" });
    const inactiveRes = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "B", lastName: "Two", joiningDate: "2026-01-01" });
    await request(app)
      .patch(`/api/v1/employees/${inactiveRes.body.employee.id}/status`)
      .set("Authorization", token)
      .send({ status: "INACTIVE" });

    const res = await request(app)
      .post("/api/v1/leave-types")
      .set("Authorization", token)
      .send({ name: "Bereavement Leave", code: "BEREAVEMENT", defaultAnnualDays: 3 });
    expect(res.status).toBe(201);

    const balances = await platformPrisma.leaveBalance.findMany({
      where: { companyId: company.id, leaveTypeId: res.body.leaveType.id },
    });
    // only the ACTIVE employee gets a balance, not the inactive one
    expect(balances).toHaveLength(1);
    expect(balances[0]!.allocatedDays.toNumber()).toBe(3);
  });

  it("rejects a duplicate leave type code", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    await request(app)
      .post("/api/v1/leave-types")
      .set("Authorization", token)
      .send({ name: "Parental Leave", code: "PARENTAL", defaultAnnualDays: 5 });

    const res = await request(app)
      .post("/api/v1/leave-types")
      .set("Authorization", token)
      .send({ name: "Parental Leave 2", code: "PARENTAL", defaultAnnualDays: 5 });
    expect(res.status).toBe(409);
  });

  it("blocks deleting a leave type that still has balances", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    // an employee's balances are what's "in use" here - createTestCompany
    // seeds leave types but no employees, so one must exist first.
    await request(app)
      .post("/api/v1/employees")
      .set("Authorization", token)
      .send({ firstName: "Has", lastName: "Balance", joiningDate: "2026-01-01" });

    const typesRes = await request(app).get("/api/v1/leave-types").set("Authorization", token);
    const sickType = typesRes.body.data.find((t: { code: string }) => t.code === "SICK");

    const res = await request(app).delete(`/api/v1/leave-types/${sickType.id}`).set("Authorization", token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LEAVE_TYPE_IN_USE");
  });

  it("MANAGER cannot create a leave type", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "MANAGER", employeeCode: "EMP-001" });

    const res = await request(app)
      .post("/api/v1/leave-types")
      .set("Authorization", token)
      .send({ name: "X", code: "X", defaultAnnualDays: 1 });
    expect(res.status).toBe(403);
  });

  it("cross-tenant: company B gets 404 updating company A's leave type", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: otherToken } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const createRes = await request(app)
      .post("/api/v1/leave-types")
      .set("Authorization", token)
      .send({ name: "Unique To A", code: "UNIQUEA", defaultAnnualDays: 2 });

    const res = await request(app)
      .patch(`/api/v1/leave-types/${createRes.body.leaveType.id}`)
      .set("Authorization", otherToken)
      .send({ name: "Hacked" });
    expect(res.status).toBe(404);
  });
});
