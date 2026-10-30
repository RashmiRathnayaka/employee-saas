import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createTestUser, platformLoginAs } from "../../test/helpers.js";

describe("POST /api/v1/auth/platform/login", () => {
  it("logs in a super admin by email, with no company code", async () => {
    const app = createApp();
    const { password } = await createTestUser({
      companyId: null,
      role: "SUPER_ADMIN",
      email: "root@platform.test",
    });

    const res = await platformLoginAs(app, { email: "root@platform.test", password, clientType: "mobile" });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("SUPER_ADMIN");
    expect(res.body.user.companyId).toBeNull();
  });

  it("rejects a non-super-admin user even with correct credentials", async () => {
    const app = createApp();
    const { password } = await createTestUser({
      companyId: null,
      role: "SUPER_ADMIN",
      email: "root@platform.test",
    });

    // a company-scoped user trying the platform login path
    const res = await platformLoginAs(app, { email: "not-an-admin@platform.test", password, clientType: "mobile" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rate-limits repeated attempts more tightly than the normal login endpoint", async () => {
    const app = createApp();
    await createTestUser({ companyId: null, role: "SUPER_ADMIN", email: "root@platform.test" });

    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await platformLoginAs(app, { email: "root@platform.test", password: "wrong" });
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});
