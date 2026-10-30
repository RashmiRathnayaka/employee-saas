import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { bearerFor, createTestUser, setUpCompanyWithUser } from "../../test/helpers.js";

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
});
