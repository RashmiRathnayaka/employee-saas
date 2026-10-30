import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createTestUser, platformLoginAs, setUpCompanyWithUser } from "../../test/helpers.js";

describe("company profile + settings + holidays", () => {
  it("lets any company member view the profile and settings", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "EMPLOYEE", employeeCode: "EMP-001" });

    const profileRes = await request(app).get("/api/v1/company").set("Authorization", token);
    expect(profileRes.status).toBe(200);

    const settingsRes = await request(app).get("/api/v1/company/settings").set("Authorization", token);
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.body.settings.leaveApprovalWorkflow).toBe("MANAGER_ONLY");
  });

  it("only lets COMPANY_ADMIN edit settings - HR is forbidden", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "HR", employeeCode: "EMP-001" });

    const res = await request(app)
      .patch("/api/v1/company/settings")
      .set("Authorization", token)
      .send({ sickLeaveProofDeadlineDays: 5 });

    expect(res.status).toBe(403);
  });

  it("lets COMPANY_ADMIN update settings", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const res = await request(app)
      .patch("/api/v1/company/settings")
      .set("Authorization", token)
      .send({ sickLeaveProofDeadlineDays: 5 });

    expect(res.status).toBe(200);
    expect(res.body.settings.sickLeaveProofDeadlineDays).toBe(5);
  });

  it("creates and deletes holidays, rejecting a duplicate date", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "HR", employeeCode: "EMP-001" });

    const createRes = await request(app)
      .post("/api/v1/company/holidays")
      .set("Authorization", token)
      .send({ date: "2026-01-01", name: "New Year's Day" });
    expect(createRes.status).toBe(201);

    const dupeRes = await request(app)
      .post("/api/v1/company/holidays")
      .set("Authorization", token)
      .send({ date: "2026-01-01", name: "Also New Year" });
    expect(dupeRes.status).toBe(409);

    const listRes = await request(app).get("/api/v1/company/holidays").set("Authorization", token);
    expect(listRes.body.data).toHaveLength(1);

    const deleteRes = await request(app)
      .delete(`/api/v1/company/holidays/${createRes.body.holiday.id}`)
      .set("Authorization", token);
    expect(deleteRes.status).toBe(204);
  });

  it("blocks a SUPER_ADMIN from own-company endpoints (no company context)", async () => {
    const app = createApp();
    await createTestUser({ companyId: null, role: "SUPER_ADMIN", email: "root@platform.test" });
    const loginRes = await platformLoginAs(app, {
      email: "root@platform.test",
      password: "Passw0rd!",
      clientType: "mobile",
    });

    const res = await request(app)
      .get("/api/v1/company")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`);

    expect(res.status).toBe(403);
  });
});
