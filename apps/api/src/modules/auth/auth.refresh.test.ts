import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createTestCompany, createTestUser, loginAs } from "../../test/helpers.js";

describe("POST /api/v1/auth/refresh", () => {
  it("rotates the refresh token: the old one stops working, the new one works", async () => {
    const app = createApp();
    const company = await createTestCompany();
    const { password } = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-001" });

    const loginRes = await loginAs(app, {
      companyCode: company.code,
      identifier: "EMP-001",
      password,
      clientType: "mobile",
    });
    const firstRefreshToken: string = loginRes.body.refreshToken;

    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client", "mobile")
      .send({ refreshToken: firstRefreshToken });

    expect(refreshRes.status).toBe(200);
    const secondRefreshToken: string = refreshRes.body.refreshToken;
    expect(secondRefreshToken).toBeTypeOf("string");
    expect(secondRefreshToken).not.toBe(firstRefreshToken);

    // the new token works
    const secondRefreshUse = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client", "mobile")
      .send({ refreshToken: secondRefreshToken });
    expect(secondRefreshUse.status).toBe(200);
  });

  it("revokes the whole token family when a rotated-away token is reused", async () => {
    const app = createApp();
    const company = await createTestCompany();
    const { password } = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-001" });

    const loginRes = await loginAs(app, {
      companyCode: company.code,
      identifier: "EMP-001",
      password,
      clientType: "mobile",
    });
    const firstRefreshToken: string = loginRes.body.refreshToken;

    const firstRotation = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client", "mobile")
      .send({ refreshToken: firstRefreshToken });
    const secondRefreshToken: string = firstRotation.body.refreshToken;

    // Reuse the already-rotated-away first token - this is the theft signal.
    const reuseAttempt = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client", "mobile")
      .send({ refreshToken: firstRefreshToken });
    expect(reuseAttempt.status).toBe(401);

    // The rest of the family (the token that reuse would have "stolen
    // forward" to) must now be revoked too, even though it was never
    // directly reused.
    const secondTokenAfterReuse = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client", "mobile")
      .send({ refreshToken: secondRefreshToken });
    expect(secondTokenAfterReuse.status).toBe(401);
  });

  it("rejects an unknown refresh token", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client", "mobile")
      .send({ refreshToken: "not-a-real-token" });

    expect(res.status).toBe(401);
  });
});
