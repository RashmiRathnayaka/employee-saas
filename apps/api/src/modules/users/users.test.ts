import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { bearerFor, createTestUser, loginAs, setUpCompanyWithUser } from "../../test/helpers.js";

describe("users module", () => {
  it("lets COMPANY_ADMIN create a user and returns a one-time temporary password", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const res = await request(app)
      .post("/api/v1/users")
      .set("Authorization", token)
      .send({ email: "newhire@example.test", role: "HR" });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("HR");
    expect(res.body.user.mustChangePassword).toBe(true);
    expect(typeof res.body.temporaryPassword).toBe("string");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("HR cannot create users", async () => {
    const app = createApp();
    const { token } = await setUpCompanyWithUser(app, { role: "HR", employeeCode: "EMP-001" });

    const res = await request(app)
      .post("/api/v1/users")
      .set("Authorization", token)
      .send({ email: "newhire@example.test", role: "HR" });

    expect(res.status).toBe(403);
  });

  it("blocks the sole active COMPANY_ADMIN from deactivating themselves", async () => {
    const app = createApp();
    const { token, user } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const res = await request(app)
      .patch(`/api/v1/users/${user.id}/status`)
      .set("Authorization", token)
      .send({ status: "DEACTIVATED" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CANNOT_MODIFY_SELF");
  });

  it("blocks the sole active COMPANY_ADMIN from removing their own admin role", async () => {
    const app = createApp();
    const { token, user } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

    const res = await request(app).patch(`/api/v1/users/${user.id}`).set("Authorization", token).send({ role: "HR" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CANNOT_MODIFY_SELF");
  });

  it("lets one admin demote/deactivate a different admin when another admin remains active", async () => {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { user: secondAdmin, password: secondPassword } = await createTestUser({
      companyId: company.id,
      role: "COMPANY_ADMIN",
      email: "second-admin@example.test",
    });

    const demoteRes = await request(app)
      .patch(`/api/v1/users/${secondAdmin.id}`)
      .set("Authorization", token)
      .send({ role: "HR" });
    expect(demoteRes.status).toBe(200);
    expect(demoteRes.body.user.role).toBe("HR");

    // confirm the demoted user really lost admin access
    const demotedToken = await bearerFor(app, {
      companyCode: company.code,
      identifier: "second-admin@example.test",
      password: secondPassword,
    });
    const forbidden = await request(app)
      .post("/api/v1/users")
      .set("Authorization", demotedToken)
      .send({ email: "someone@example.test", role: "HR" });
    expect(forbidden.status).toBe(403);
  });

  it("cross-tenant: company B gets 404 for company A's user (update role, update status)", async () => {
    const app = createApp();
    const { company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: otherToken } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { user: targetUser } = await createTestUser({
      companyId: company.id,
      role: "HR",
      email: "target@example.test",
    });

    const roleRes = await request(app)
      .patch(`/api/v1/users/${targetUser.id}`)
      .set("Authorization", otherToken)
      .send({ role: "MANAGER" });
    expect(roleRes.status).toBe(404);

    const statusRes = await request(app)
      .patch(`/api/v1/users/${targetUser.id}/status`)
      .set("Authorization", otherToken)
      .send({ status: "DEACTIVATED" });
    expect(statusRes.status).toBe(404);
  });

  it("resets a user's password: temp password works, old refresh token is revoked", async () => {
    const app = createApp();
    const { token, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { password } = await createTestUser({ companyId: company.id, role: "HR", email: "hr@example.test" });

    const oldLogin = await bearerForRefresh(app, {
      companyCode: company.code,
      identifier: "hr@example.test",
      password,
    });

    const target = await findUserByEmail(company.id, "hr@example.test");
    const resetRes = await request(app)
      .post(`/api/v1/users/${target.id}/reset-password`)
      .set("Authorization", token);
    expect(resetRes.status).toBe(200);
    const newTempPassword = resetRes.body.temporaryPassword;
    expect(typeof newTempPassword).toBe("string");

    // old refresh token no longer works
    const refreshAfterReset = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client", "mobile")
      .send({ refreshToken: oldLogin.refreshToken });
    expect(refreshAfterReset.status).toBe(401);

    // old password no longer works, new temp password does and requires a change
    const oldPasswordLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ companyCode: company.code, identifier: "hr@example.test", password });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ companyCode: company.code, identifier: "hr@example.test", password: newTempPassword });
    expect(newPasswordLogin.status).toBe(200);
  });

  it("HR cannot reset a COMPANY_ADMIN's password", async () => {
    const app = createApp();
    const { company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { user: admin } = await createTestUser({
      companyId: company.id,
      role: "COMPANY_ADMIN",
      email: "admin2@example.test",
    });
    const { password: hrPassword } = await createTestUser({
      companyId: company.id,
      role: "HR",
      email: "hr2@example.test",
    });
    const hrToken = await bearerFor(app, {
      companyCode: company.code,
      identifier: "hr2@example.test",
      password: hrPassword,
    });

    const res = await request(app).post(`/api/v1/users/${admin.id}/reset-password`).set("Authorization", hrToken);
    expect(res.status).toBe(403);
  });
});

async function bearerForRefresh(
  app: Parameters<typeof loginAs>[0],
  params: { companyCode: string; identifier: string; password: string },
) {
  const res = await loginAs(app, { ...params, clientType: "mobile" });
  return { accessToken: res.body.accessToken as string, refreshToken: res.body.refreshToken as string };
}

async function findUserByEmail(companyId: string, email: string) {
  const { platformPrisma } = await import("../../lib/prisma.js");
  const user = await platformPrisma.user.findFirst({ where: { companyId, email } });
  if (!user) throw new Error("user not found");
  return user;
}
