import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createTestCompany, setUpCompanyWithUser } from "../../test/helpers.js";
import { platformPrisma } from "../../lib/prisma.js";

describe("departments module", () => {
  it("rejects a case-insensitive duplicate name", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "HR", employeeCode: "EMP-001" });

    const first = await request(app).post("/api/v1/departments").set("Authorization", token).send({ name: "Engineering" });
    expect(first.status).toBe(201);

    const dupe = await request(app)
      .post("/api/v1/departments")
      .set("Authorization", token)
      .send({ name: "engineering" });
    expect(dupe.status).toBe(409);
  });

  it("MANAGER cannot create a department", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "MANAGER", employeeCode: "EMP-001" });

    const res = await request(app).post("/api/v1/departments").set("Authorization", token).send({ name: "Sales" });
    expect(res.status).toBe(403);
  });

  it("returns 409 when deleting a department that still has employees", async () => {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const deptRes = await request(app).post("/api/v1/departments").set("Authorization", token).send({ name: "Ops" });
    const departmentId = deptRes.body.department.id;

    await platformPrisma.employee.create({
      data: {
        companyId: company.id,
        employeeCode: "OPS-001",
        firstName: "Taken",
        lastName: "Seat",
        departmentId,
        joiningDate: new Date("2024-01-01"),
      },
    });

    const deleteRes = await request(app).delete(`/api/v1/departments/${departmentId}`).set("Authorization", token);
    expect(deleteRes.status).toBe(409);
    expect(deleteRes.body.error.code).toBe("DEPARTMENT_IN_USE");
  });

  it("company B cannot read, update, or delete company A's department", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: otherToken } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    await createTestCompany();

    const createRes = await request(app)
      .post("/api/v1/departments")
      .set("Authorization", token)
      .send({ name: "Finance" });
    const departmentId = createRes.body.department.id;

    const updateRes = await request(app)
      .patch(`/api/v1/departments/${departmentId}`)
      .set("Authorization", otherToken)
      .send({ name: "Hacked" });
    expect(updateRes.status).toBe(404);

    const deleteRes = await request(app)
      .delete(`/api/v1/departments/${departmentId}`)
      .set("Authorization", otherToken);
    expect(deleteRes.status).toBe(404);
  });
});
