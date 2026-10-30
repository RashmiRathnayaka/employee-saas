import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { setUpCompanyWithUser } from "../../test/helpers.js";
import { platformPrisma } from "../../lib/prisma.js";

describe("designations module", () => {
  it("rejects a case-insensitive duplicate name", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "HR", employeeCode: "EMP-001" });

    const first = await request(app)
      .post("/api/v1/designations")
      .set("Authorization", token)
      .send({ name: "Software Engineer" });
    expect(first.status).toBe(201);

    const dupe = await request(app)
      .post("/api/v1/designations")
      .set("Authorization", token)
      .send({ name: "SOFTWARE ENGINEER" });
    expect(dupe.status).toBe(409);
  });

  it("EMPLOYEE cannot create a designation", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "EMPLOYEE", employeeCode: "EMP-001" });

    const res = await request(app)
      .post("/api/v1/designations")
      .set("Authorization", token)
      .send({ name: "Intern" });
    expect(res.status).toBe(403);
  });

  it("returns 409 when deleting a designation that still has employees", async () => {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const desigRes = await request(app)
      .post("/api/v1/designations")
      .set("Authorization", token)
      .send({ name: "Analyst" });
    const designationId = desigRes.body.designation.id;

    await platformPrisma.employee.create({
      data: {
        companyId: company.id,
        employeeCode: "AN-001",
        firstName: "Taken",
        lastName: "Seat",
        designationId,
        joiningDate: new Date("2024-01-01"),
      },
    });

    const deleteRes = await request(app).delete(`/api/v1/designations/${designationId}`).set("Authorization", token);
    expect(deleteRes.status).toBe(409);
    expect(deleteRes.body.error.code).toBe("DESIGNATION_IN_USE");
  });

  it("company B cannot read, update, or delete company A's designation", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: otherToken } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const createRes = await request(app)
      .post("/api/v1/designations")
      .set("Authorization", token)
      .send({ name: "Director" });
    const designationId = createRes.body.designation.id;

    const updateRes = await request(app)
      .patch(`/api/v1/designations/${designationId}`)
      .set("Authorization", otherToken)
      .send({ name: "Hacked" });
    expect(updateRes.status).toBe(404);

    const deleteRes = await request(app)
      .delete(`/api/v1/designations/${designationId}`)
      .set("Authorization", otherToken);
    expect(deleteRes.status).toBe(404);
  });
});
