import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createTestCompany, createTestUser, loginAs } from "../../test/helpers.js";

describe("POST /api/v1/auth/login", () => {
  it("logs in by employee code (web client gets cookies, no tokens in body)", async () => {
    const app = createApp();
    const company = await createTestCompany();
    const { password } = await createTestUser({
      companyId: company.id,
      role: "EMPLOYEE",
      employeeCode: "EMP-001",
      email: "worker@example.test",
    });

    const res = await loginAs(app, { companyCode: company.code, identifier: "EMP-001", password });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("EMPLOYEE");
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookies = Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie);
    expect(cookies).toContain("accessToken=");
    expect(cookies).toContain("refreshToken=");
    expect(cookies).toContain("HttpOnly");
  });

  it("logs in by email (mobile client gets tokens in the body, no cookies)", async () => {
    const app = createApp();
    const company = await createTestCompany();
    const { password } = await createTestUser({
      companyId: company.id,
      role: "COMPANY_ADMIN",
      email: "admin@example.test",
    });

    const res = await loginAs(app, {
      companyCode: company.code,
      identifier: "admin@example.test",
      password,
      clientType: "mobile",
    });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects a wrong password with the generic error", async () => {
    const app = createApp();
    const company = await createTestCompany();
    await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-001" });

    const res = await loginAs(app, { companyCode: company.code, identifier: "EMP-001", password: "WrongPass1!" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects an unknown company code with the same generic error", async () => {
    const app = createApp();

    const res = await loginAs(app, { companyCode: "NOPE", identifier: "someone@example.test", password: "whatever1" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a deactivated user with the same generic error", async () => {
    const app = createApp();
    const company = await createTestCompany();
    const { password } = await createTestUser({
      companyId: company.id,
      role: "EMPLOYEE",
      employeeCode: "EMP-001",
      status: "DEACTIVATED",
    });

    const res = await loginAs(app, { companyCode: company.code, identifier: "EMP-001", password });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects login for a suspended company with the same generic error", async () => {
    const app = createApp();
    const company = await createTestCompany({ status: "SUSPENDED" });
    const { password } = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-001" });

    const res = await loginAs(app, { companyCode: company.code, identifier: "EMP-001", password });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("logs in a super admin with no company code", async () => {
    const app = createApp();
    const { password } = await createTestUser({
      companyId: null,
      role: "SUPER_ADMIN",
      email: "root@platform.test",
    });

    const res = await loginAs(app, { identifier: "root@platform.test", password, clientType: "mobile" });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("SUPER_ADMIN");
    expect(res.body.user.companyId).toBeNull();
  });

  it("rate-limits repeated login attempts for the same IP + company code", async () => {
    const app = createApp();
    const company = await createTestCompany();
    await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-001" });

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await loginAs(app, { companyCode: company.code, identifier: "EMP-001", password: "wrong" });
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});
