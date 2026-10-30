import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createTestCompany, createTestUser, loginAs, platformLoginAs } from "../../test/helpers.js";
import { platformPrisma } from "../../lib/prisma.js";

async function superAdminToken(app: ReturnType<typeof createApp>) {
  const { password } = await createTestUser({ companyId: null, role: "SUPER_ADMIN", email: "root@platform.test" });
  const res = await platformLoginAs(app, { email: "root@platform.test", password, clientType: "mobile" });
  return `Bearer ${res.body.accessToken as string}`;
}

describe("POST /api/v1/companies", () => {
  it("creates a company with settings, an admin, and default leave types, in one go", async () => {
    const app = createApp();
    const token = await superAdminToken(app);

    const res = await request(app)
      .post("/api/v1/companies")
      .set("Authorization", token)
      .send({ name: "New Co", code: "newco", adminEmail: "admin@newco.test" });

    expect(res.status).toBe(201);
    expect(res.body.company.code).toBe("NEWCO");
    expect(typeof res.body.temporaryPassword).toBe("string");

    const settings = await platformPrisma.companySettings.findUnique({ where: { companyId: res.body.company.id } });
    expect(settings).not.toBeNull();

    const admin = await platformPrisma.user.findUnique({ where: { id: res.body.admin.id } });
    expect(admin?.role).toBe("COMPANY_ADMIN");
    expect(admin?.mustChangePassword).toBe(true);

    const leaveTypes = await platformPrisma.leaveType.findMany({ where: { companyId: res.body.company.id } });
    expect(leaveTypes).toHaveLength(3);
  });

  it("rejects a duplicate company code", async () => {
    const app = createApp();
    const token = await superAdminToken(app);
    await createTestCompany({ code: "DUPE" });

    const res = await request(app)
      .post("/api/v1/companies")
      .set("Authorization", token)
      .send({ name: "Dupe Co", code: "DUPE", adminEmail: "admin@dupe.test" });

    expect(res.status).toBe(409);
  });

  it("is forbidden for a non-super-admin", async () => {
    const app = createApp();
    const company = await createTestCompany();
    const { password } = await createTestUser({
      companyId: company.id,
      role: "COMPANY_ADMIN",
      email: "admin@example.test",
    });
    const loginRes = await loginAs(app, {
      companyCode: company.code,
      identifier: "admin@example.test",
      password,
      clientType: "mobile",
    });

    const res = await request(app)
      .post("/api/v1/companies")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .send({ name: "New Co", code: "ABC123", adminEmail: "admin@abc.test" });

    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/v1/companies/:id/status", () => {
  it("suspends and reactivates a company", async () => {
    const app = createApp();
    const token = await superAdminToken(app);
    const company = await createTestCompany();

    const suspendRes = await request(app)
      .patch(`/api/v1/companies/${company.id}/status`)
      .set("Authorization", token)
      .send({ status: "SUSPENDED" });
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.company.status).toBe("SUSPENDED");

    const reactivateRes = await request(app)
      .patch(`/api/v1/companies/${company.id}/status`)
      .set("Authorization", token)
      .send({ status: "ACTIVE" });
    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.company.status).toBe("ACTIVE");
  });
});
