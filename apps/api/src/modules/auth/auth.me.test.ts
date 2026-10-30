import { describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createTestCompany, createTestUser, loginAs } from "../../test/helpers.js";

describe("GET /api/v1/auth/me", () => {
  it("returns the current user for a valid access token", async () => {
    const app = createApp();
    const company = await createTestCompany();
    const { password } = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-001" });

    const loginRes = await loginAs(app, {
      companyCode: company.code,
      identifier: "EMP-001",
      password,
      clientType: "mobile",
    });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("EMPLOYEE");
  });

  it("rejects a missing token", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects an expired access token", async () => {
    const app = createApp();
    const company = await createTestCompany();
    const { user } = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-001" });

    const expiredToken = jwt.sign(
      { userId: user.id, companyId: user.companyId, role: user.role },
      config.JWT_ACCESS_SECRET,
      { expiresIn: "-10s" },
    );

    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it("rejects a tampered access token", async () => {
    const app = createApp();
    const company = await createTestCompany();
    const { password } = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-001" });

    const loginRes = await loginAs(app, {
      companyCode: company.code,
      identifier: "EMP-001",
      password,
      clientType: "mobile",
    });
    const validToken: string = loginRes.body.accessToken;
    const tamperedToken = validToken.slice(0, -2) + (validToken.slice(-2) === "aa" ? "bb" : "aa");

    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${tamperedToken}`);
    expect(res.status).toBe(401);
  });
});
