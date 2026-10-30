import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createTestCompany, createTestUser, loginAs } from "../../test/helpers.js";

describe("POST /api/v1/auth/logout", () => {
  it("revokes the refresh token so it can no longer be used", async () => {
    const app = createApp();
    const company = await createTestCompany();
    const { password } = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-001" });

    const loginRes = await loginAs(app, {
      companyCode: company.code,
      identifier: "EMP-001",
      password,
      clientType: "mobile",
    });
    const refreshToken: string = loginRes.body.refreshToken;

    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("X-Client", "mobile")
      .send({ refreshToken });
    expect(logoutRes.status).toBe(200);

    const refreshAfterLogout = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client", "mobile")
      .send({ refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
  });
});
