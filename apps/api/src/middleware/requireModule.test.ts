import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createApp } from "../app.js";
import { invalidateEnabledModulesCache } from "../lib/enabledModules.js";
import { platformPrisma } from "../lib/prisma.js";
import { createTestUser, platformLoginAs, setUpCompanyWithUser } from "../test/helpers.js";
import { errorHandler } from "./errorHandler.js";
import { requireAuth } from "./requireAuth.js";
import { requireModule } from "./requireModule.js";

/** A small router wired the way the real ones are, with the real auth and error
 * handler, so these tests cover the middleware itself. Each gated module's own
 * tests cover its real routes (see sites.test.ts). */
function gatedApp() {
  const app = express();
  app.get("/gated", requireAuth, requireModule("attendance"), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

async function setModules(companyId: string, enabledModules: Record<string, boolean>) {
  await platformPrisma.companySettings.update({ where: { companyId }, data: { enabledModules } });
  invalidateEnabledModulesCache(companyId);
}

describe("requireModule", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers 403 MODULE_DISABLED for a new company, whose settings have no module keys", async () => {
    const { token } = await setUpCompanyWithUser(createApp(), { role: "COMPANY_ADMIN" });

    const res = await request(gatedApp()).get("/gated").set("Authorization", token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("MODULE_DISABLED");
    expect(res.body.error.details).toEqual({ module: "attendance" });
  });

  it("lets the request through when the module is on", async () => {
    const { company, token } = await setUpCompanyWithUser(createApp(), { role: "EMPLOYEE", employeeCode: "EMP-001" });
    await setModules(company.id, { attendance: true });

    const res = await request(gatedApp()).get("/gated").set("Authorization", token);

    expect(res.status).toBe(200);
  });

  it("blocks when the key is explicitly false, or when only another module is on", async () => {
    const { company, token } = await setUpCompanyWithUser(createApp(), { role: "COMPANY_ADMIN" });

    await setModules(company.id, { attendance: false, sites: true, tasks: true });
    const res = await request(gatedApp()).get("/gated").set("Authorization", token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("MODULE_DISABLED");
  });

  it("blocks when the company has no settings row at all", async () => {
    const { company, token } = await setUpCompanyWithUser(createApp(), { role: "COMPANY_ADMIN" });
    await platformPrisma.companySettings.delete({ where: { companyId: company.id } });
    invalidateEnabledModulesCache(company.id);

    const res = await request(gatedApp()).get("/gated").set("Authorization", token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("MODULE_DISABLED");
  });

  it("checks authentication first: no token is 401, not MODULE_DISABLED", async () => {
    const res = await request(gatedApp()).get("/gated");
    expect(res.status).toBe(401);
  });

  it("answers 403 FORBIDDEN for a SUPER_ADMIN, who has no company", async () => {
    await createTestUser({ companyId: null, role: "SUPER_ADMIN", email: "root@platform.test" });
    const loginRes = await platformLoginAs(createApp(), {
      email: "root@platform.test",
      password: "Passw0rd!",
      clientType: "mobile",
    });

    const res = await request(gatedApp()).get("/gated").set("Authorization", `Bearer ${loginRes.body.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  describe("tenant isolation", () => {
    it("uses the caller's own company: A's switch doesn't open it for B", async () => {
      const app = createApp();
      const a = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
      const b = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
      await setModules(a.company.id, { attendance: true });

      const aRes = await request(gatedApp()).get("/gated").set("Authorization", a.token);
      const bRes = await request(gatedApp()).get("/gated").set("Authorization", b.token);

      expect(aRes.status).toBe(200);
      expect(bRes.status).toBe(403);
    });

    it("ignores a companyId in the query string or headers", async () => {
      const app = createApp();
      const a = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
      const b = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
      await setModules(a.company.id, { attendance: true });

      const res = await request(gatedApp())
        .get(`/gated?companyId=${a.company.id}`)
        .set("Authorization", b.token)
        .set("X-Company-Id", a.company.id);

      expect(res.status).toBe(403);
    });
  });

  describe("cache", () => {
    it("takes effect at once when changed through PATCH /company/settings", async () => {
      const app = createApp();
      const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
      const gated = gatedApp();

      expect((await request(gated).get("/gated").set("Authorization", token)).status).toBe(403);

      await request(app).patch("/api/v1/company/settings").set("Authorization", token).send({ enabledModules: { attendance: true } });
      expect((await request(gated).get("/gated").set("Authorization", token)).status).toBe(200);

      await request(app).patch("/api/v1/company/settings").set("Authorization", token).send({ enabledModules: { attendance: false } });
      expect((await request(gated).get("/gated").set("Authorization", token)).status).toBe(403);
    });

    it("picks up a change made elsewhere (another API instance) once the entry expires after 30 s", async () => {
      const { company, token } = await setUpCompanyWithUser(createApp(), { role: "COMPANY_ADMIN" });
      const gated = gatedApp();
      const start = Date.now();
      // Only Date is faked: real timers keep the DB driver and supertest working.
      vi.useFakeTimers({ toFake: ["Date"], now: start });

      // Caches "off".
      expect((await request(gated).get("/gated").set("Authorization", token)).status).toBe(403);

      // Another instance's write: it can't drop this process's cache entry.
      await platformPrisma.companySettings.update({
        where: { companyId: company.id },
        data: { enabledModules: { attendance: true } },
      });

      vi.setSystemTime(start + 29_000);
      expect((await request(gated).get("/gated").set("Authorization", token)).status).toBe(403);

      vi.setSystemTime(start + 31_000);
      expect((await request(gated).get("/gated").set("Authorization", token)).status).toBe(200);
    });
  });
});
