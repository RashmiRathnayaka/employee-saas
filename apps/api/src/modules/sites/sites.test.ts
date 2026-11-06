import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { SiteSchema, SiteSummarySchema } from "@employee-saas/shared";
import { createApp } from "../../app.js";
import { invalidateEnabledModulesCache } from "../../lib/enabledModules.js";
import { platformPrisma } from "../../lib/prisma.js";
import { createTestCompany, createTestUser, platformLoginAs, setUpCompanyWithUser } from "../../test/helpers.js";

const app = createApp();

const OFFICE = {
  name: "Head Office",
  type: "OFFICE",
  address: "1 Galle Road, Colombo",
  latitude: 6.927079,
  longitude: 79.861244,
  radiusMeters: 200,
  gpsRequired: true,
};

async function setSitesModule(companyId: string, on: boolean) {
  await platformPrisma.companySettings.update({ where: { companyId }, data: { enabledModules: { sites: on } } });
  invalidateEnabledModulesCache(companyId);
}

/** A company with the sites module on, and someone logged in. */
async function setUp(role: "COMPANY_ADMIN" | "HR" | "MANAGER" | "EMPLOYEE" = "HR") {
  const result = await setUpCompanyWithUser(app, {
    role,
    employeeCode: role === "COMPANY_ADMIN" ? undefined : "EMP-001",
  });
  await setSitesModule(result.company.id, true);
  return result;
}

/** A second login in the same company. */
async function loginInCompany(company: { id: string; code: string }, role: "MANAGER" | "EMPLOYEE" | "HR", code: string) {
  const email = `${code.toLowerCase()}@example.test`;
  const { password } = await createTestUser({ companyId: company.id, role, email, employeeCode: code });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Client", "mobile")
    .send({ companyCode: company.code, identifier: email, password });
  return `Bearer ${res.body.accessToken as string}`;
}

function post(token: string, body: object) {
  return request(app).post("/api/v1/sites").set("Authorization", token).send(body);
}

async function createSite(token: string, body: object = OFFICE) {
  const res = await post(token, body);
  expect(res.status).toBe(201);
  return res.body.site as { id: string; name: string };
}

function audits(companyId: string, action: string) {
  return platformPrisma.auditLog.findMany({ where: { companyId, action } });
}

describe("sites module", () => {
  describe("create", () => {
    it.each(["COMPANY_ADMIN", "HR"] as const)("%s can create a site, and it's audited", async (role) => {
      const { company, user, token } = await setUp(role);

      const res = await post(token, OFFICE);

      expect(res.status).toBe(201);
      expect(SiteSchema.strict().safeParse(res.body.site).success).toBe(true);
      expect(res.body.site).toMatchObject({ ...OFFICE, isActive: true });

      const row = await platformPrisma.site.findUniqueOrThrow({ where: { id: res.body.site.id } });
      expect(row.companyId).toBe(company.id);
      expect(row.createdByUserId).toBe(user.id);

      const [audit] = await audits(company.id, "SITE_CREATED");
      expect(audit).toMatchObject({ actorUserId: user.id, entityType: "Site", entityId: res.body.site.id });
    });

    it.each(["MANAGER", "EMPLOYEE"] as const)("%s can't create a site", async (role) => {
      const { company, token } = await setUp(role);

      const res = await post(token, OFFICE);

      expect(res.status).toBe(403);
      expect(await platformPrisma.site.count({ where: { companyId: company.id } })).toBe(0);
    });

    it("takes a missing radius and gpsRequired from the company's defaults", async () => {
      const { company, token } = await setUp();
      await platformPrisma.companySettings.update({
        where: { companyId: company.id },
        data: { gpsRadiusMeters: 350, gpsCheckinEnabledDefault: true },
      });

      const res = await post(token, { name: "Branch", type: "OFFICE", latitude: 7.29, longitude: 80.63 });

      expect(res.status).toBe(201);
      expect(res.body.site).toMatchObject({ radiusMeters: 350, gpsRequired: true });
    });

    it("lets a sent radius and gpsRequired override the defaults", async () => {
      const { company, token } = await setUp();
      await platformPrisma.companySettings.update({
        where: { companyId: company.id },
        data: { gpsRadiusMeters: 350, gpsCheckinEnabledDefault: true },
      });

      const res = await post(token, { name: "Yard", type: "EXTERNAL", radiusMeters: 50, gpsRequired: false });

      expect(res.status).toBe(201);
      expect(res.body.site).toMatchObject({ radiusMeters: 50, gpsRequired: false, latitude: null, longitude: null });
    });

    it("rejects a site that defaults to GPS required but has no coordinates, on the latitude field", async () => {
      const { company, token } = await setUp();
      await platformPrisma.companySettings.update({
        where: { companyId: company.id },
        data: { gpsCheckinEnabledDefault: true },
      });

      const res = await post(token, { name: "Yard", type: "EXTERNAL" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.fieldErrors.latitude).toBeDefined();
    });

    it("rejects half a position", async () => {
      const { token } = await setUp();

      const res = await post(token, { name: "Yard", type: "EXTERNAL", latitude: 6.9 });

      expect(res.status).toBe(400);
      expect(res.body.error.details.fieldErrors.longitude).toBeDefined();
    });

    it.each([
      [{ latitude: 91, longitude: 79 }],
      [{ latitude: 6, longitude: 181 }],
      [{ radiusMeters: 24 }],
      [{ radiusMeters: 5001 }],
      [{ type: "WAREHOUSE" }],
      [{ name: "" }],
    ])("rejects %j with 400 and writes nothing", async (body) => {
      const { company, token } = await setUp();

      const res = await post(token, { name: "Yard", type: "EXTERNAL", ...body });

      expect(res.status).toBe(400);
      expect(await platformPrisma.site.count({ where: { companyId: company.id } })).toBe(0);
      expect(await audits(company.id, "SITE_CREATED")).toHaveLength(0);
    });

    it("rejects a duplicate name, ignoring case", async () => {
      const { token } = await setUp();
      await createSite(token);

      const res = await post(token, { ...OFFICE, name: "HEAD office" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SITE_NAME_TAKEN");
    });

    it("counts an inactive site's name as taken", async () => {
      const { token } = await setUp();
      const site = await createSite(token);
      await request(app).patch(`/api/v1/sites/${site.id}/status`).set("Authorization", token).send({ isActive: false });

      const res = await post(token, OFFICE);

      expect(res.status).toBe(409);
    });

    it("gives one winner when two requests create the same name at once", async () => {
      const { company, token } = await setUp();

      const results = await Promise.all([post(token, OFFICE), post(token, { ...OFFICE, name: "head office" })]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await platformPrisma.site.count({ where: { companyId: company.id } })).toBe(1);
      expect(await audits(company.id, "SITE_CREATED")).toHaveLength(1);
    });

    it("lets two companies use the same name", async () => {
      const a = await setUp();
      const b = await setUp();

      await createSite(a.token);
      const res = await post(b.token, OFFICE);

      expect(res.status).toBe(201);
    });
  });

  describe("list and read", () => {
    it("gives HR all sites with coordinates, and pages and sorts them", async () => {
      const { token } = await setUp();
      await createSite(token, { ...OFFICE, name: "Zeta" });
      await createSite(token, { ...OFFICE, name: "Alpha" });
      await createSite(token, { ...OFFICE, name: "Mid" });

      const res = await request(app).get("/api/v1/sites?page=1&pageSize=2").set("Authorization", token);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
      expect(res.body.data.map((s: { name: string }) => s.name)).toEqual(["Alpha", "Mid"]);
      expect(res.body.data[0].latitude).toBe(OFFICE.latitude);
    });

    it("rejects a page size over 100", async () => {
      const { token } = await setUp();
      const res = await request(app).get("/api/v1/sites?pageSize=101").set("Authorization", token);
      expect(res.status).toBe(400);
    });

    it("filters by type, active and q (name or address)", async () => {
      const { token } = await setUp();
      await createSite(token, { ...OFFICE, name: "Head Office" });
      await createSite(token, { name: "Customer A", type: "EXTERNAL", address: "Kandy Road", gpsRequired: false });
      const old = await createSite(token, { name: "Old Depot", type: "EXTERNAL", gpsRequired: false });
      await request(app).patch(`/api/v1/sites/${old.id}/status`).set("Authorization", token).send({ isActive: false });

      const names = async (query: string) => {
        const res = await request(app).get(`/api/v1/sites?${query}`).set("Authorization", token);
        expect(res.status).toBe(200);
        return res.body.data.map((s: { name: string }) => s.name);
      };

      expect(await names("type=OFFICE")).toEqual(["Head Office"]);
      expect(await names("type=EXTERNAL")).toEqual(["Customer A", "Old Depot"]);
      expect(await names("active=true")).toEqual(["Customer A", "Head Office"]);
      expect(await names("active=false")).toEqual(["Old Depot"]);
      expect(await names("q=head")).toEqual(["Head Office"]);
      expect(await names("q=KANDY")).toEqual(["Customer A"]);
      expect(await names("type=EXTERNAL&active=true&q=customer")).toEqual(["Customer A"]);
    });

    it.each(["MANAGER", "EMPLOYEE"] as const)("%s gets active sites only, with no coordinates", async (role) => {
      const { company, token: hrToken } = await setUp();
      const token = await loginInCompany(company, role, "EMP-900");
      await createSite(hrToken);
      const old = await createSite(hrToken, { name: "Old Depot", type: "EXTERNAL", gpsRequired: false });
      await request(app).patch(`/api/v1/sites/${old.id}/status`).set("Authorization", hrToken).send({ isActive: false });

      const list = await request(app).get("/api/v1/sites").set("Authorization", token);

      expect(list.status).toBe(200);
      expect(list.body.total).toBe(1);
      expect(SiteSummarySchema.strict().safeParse(list.body.data[0]).success).toBe(true);
      expect(list.body.data[0]).toMatchObject({ name: OFFICE.name, hasCoordinates: true, gpsRequired: true });
      expect(JSON.stringify(list.body)).not.toContain(String(OFFICE.latitude));

      // Asking for inactive ones doesn't get them.
      const inactive = await request(app).get("/api/v1/sites?active=false").set("Authorization", token);
      expect(inactive.body.data.map((s: { name: string }) => s.name)).toEqual([OFFICE.name]);
    });

    it("reports hasCoordinates false for a site without a position", async () => {
      const { company, token: hrToken } = await setUp();
      const token = await loginInCompany(company, "EMPLOYEE", "EMP-900");
      await createSite(hrToken, { name: "Yard", type: "EXTERNAL", gpsRequired: false });

      const res = await request(app).get("/api/v1/sites").set("Authorization", token);

      expect(res.body.data[0].hasCoordinates).toBe(false);
    });

    it("gives an employee one active site without coordinates, and 404 for an inactive one", async () => {
      const { company, token: hrToken } = await setUp();
      const token = await loginInCompany(company, "EMPLOYEE", "EMP-900");
      const site = await createSite(hrToken);

      const active = await request(app).get(`/api/v1/sites/${site.id}`).set("Authorization", token);
      expect(active.status).toBe(200);
      expect(SiteSummarySchema.strict().safeParse(active.body.site).success).toBe(true);

      await request(app).patch(`/api/v1/sites/${site.id}/status`).set("Authorization", hrToken).send({ isActive: false });
      const inactive = await request(app).get(`/api/v1/sites/${site.id}`).set("Authorization", token);
      expect(inactive.status).toBe(404);
    });

    it("lets HR read an inactive site, with coordinates", async () => {
      const { token } = await setUp();
      const site = await createSite(token);
      await request(app).patch(`/api/v1/sites/${site.id}/status`).set("Authorization", token).send({ isActive: false });

      const res = await request(app).get(`/api/v1/sites/${site.id}`).set("Authorization", token);

      expect(res.status).toBe(200);
      expect(res.body.site).toMatchObject({ isActive: false, latitude: OFFICE.latitude });
    });

    it("answers 404 for an unknown or malformed id", async () => {
      const { token } = await setUp();
      const unknown = await request(app).get("/api/v1/sites/00000000-0000-4000-8000-000000000000").set("Authorization", token);
      const malformed = await request(app).get("/api/v1/sites/not-a-uuid").set("Authorization", token);
      expect(unknown.status).toBe(404);
      expect(malformed.status).toBe(404);
    });
  });

  describe("edit", () => {
    function patch(token: string, id: string, body: object) {
      return request(app).patch(`/api/v1/sites/${id}`).set("Authorization", token).send(body);
    }

    it("saves the changes and audits only the changed fields, with before and after", async () => {
      const { company, user, token } = await setUp();
      const site = await createSite(token);

      const res = await patch(token, site.id, { ...OFFICE, name: "HQ", radiusMeters: 300, latitude: 7.5 });

      expect(res.status).toBe(200);
      expect(res.body.site).toMatchObject({ name: "HQ", radiusMeters: 300, latitude: 7.5, longitude: OFFICE.longitude });

      const [audit] = await audits(company.id, "SITE_UPDATED");
      expect(audit!.actorUserId).toBe(user.id);
      expect(audit!.metadata).toEqual({
        before: { name: OFFICE.name, radiusMeters: 200, latitude: OFFICE.latitude },
        after: { name: "HQ", radiusMeters: 300, latitude: 7.5 },
      });
    });

    it("leaves fields that weren't sent alone", async () => {
      const { token } = await setUp();
      const site = await createSite(token);

      const res = await patch(token, site.id, { radiusMeters: 500 });

      expect(res.body.site).toMatchObject({ ...OFFICE, radiusMeters: 500 });
    });

    it("writes no audit row when nothing changed", async () => {
      const { company, token } = await setUp();
      const site = await createSite(token);

      const res = await patch(token, site.id, OFFICE);

      expect(res.status).toBe(200);
      expect(await audits(company.id, "SITE_UPDATED")).toHaveLength(0);
    });

    it("can clear the address and coordinates of a site that doesn't require GPS", async () => {
      const { token } = await setUp();
      const site = await createSite(token, { ...OFFICE, gpsRequired: false });

      const res = await patch(token, site.id, { address: "", latitude: null, longitude: null });

      expect(res.status).toBe(200);
      expect(res.body.site).toMatchObject({ address: null, latitude: null, longitude: null });
    });

    it("judges a partial edit on the combined values", async () => {
      const { token } = await setUp();
      const gps = await createSite(token);
      const noGps = await createSite(token, { name: "Yard", type: "EXTERNAL", gpsRequired: false });

      // Would leave a GPS-required site without a position.
      const cleared = await patch(token, gps.id, { latitude: null, longitude: null });
      expect(cleared.status).toBe(400);
      expect(cleared.body.error.details.fieldErrors.latitude).toBeDefined();

      // Would leave half a position.
      const half = await patch(token, gps.id, { longitude: null });
      expect(half.status).toBe(400);

      // Would require GPS with no position to check against.
      const switched = await patch(token, noGps.id, { gpsRequired: true });
      expect(switched.status).toBe(400);

      // Fine: the position arrives in the same edit.
      const fixed = await patch(token, noGps.id, { gpsRequired: true, latitude: 6.9, longitude: 79.8 });
      expect(fixed.status).toBe(200);
    });

    it("rejects a name another site has, but allows changing the case of its own", async () => {
      const { token } = await setUp();
      const site = await createSite(token);
      await createSite(token, { name: "Yard", type: "EXTERNAL", gpsRequired: false });

      const taken = await patch(token, site.id, { name: "YARD" });
      expect(taken.status).toBe(409);
      expect(taken.body.error.code).toBe("SITE_NAME_TAKEN");

      const ownCase = await patch(token, site.id, { name: "HEAD OFFICE" });
      expect(ownCase.status).toBe(200);
      expect(ownCase.body.site.name).toBe("HEAD OFFICE");
    });

    it.each(["MANAGER", "EMPLOYEE"] as const)("%s can't edit a site", async (role) => {
      const { company, token: hrToken } = await setUp();
      const token = await loginInCompany(company, role, "EMP-900");
      const site = await createSite(hrToken);

      const res = await patch(token, site.id, { name: "Hacked" });

      expect(res.status).toBe(403);
    });
  });

  describe("deactivate", () => {
    function setStatus(token: string, id: string, isActive: boolean) {
      return request(app).patch(`/api/v1/sites/${id}/status`).set("Authorization", token).send({ isActive });
    }

    it("deactivates and reactivates, auditing each change", async () => {
      const { company, token } = await setUp();
      const site = await createSite(token);

      const off = await setStatus(token, site.id, false);
      expect(off.status).toBe(200);
      expect(off.body.site.isActive).toBe(false);

      const on = await setStatus(token, site.id, true);
      expect(on.body.site.isActive).toBe(true);

      const rows = await audits(company.id, "SITE_STATUS_CHANGED");
      expect(rows.map((r) => r.metadata)).toEqual(
        expect.arrayContaining([
          { before: { isActive: true }, after: { isActive: false } },
          { before: { isActive: false }, after: { isActive: true } },
        ]),
      );
    });

    it("writes no audit row when it's already in that state", async () => {
      const { company, token } = await setUp();
      const site = await createSite(token);

      const res = await setStatus(token, site.id, true);

      expect(res.status).toBe(200);
      expect(await audits(company.id, "SITE_STATUS_CHANGED")).toHaveLength(0);
    });

    it("rejects a body that isn't a boolean", async () => {
      const { token } = await setUp();
      const site = await createSite(token);

      const res = await request(app).patch(`/api/v1/sites/${site.id}/status`).set("Authorization", token).send({ isActive: "no" });

      expect(res.status).toBe(400);
    });

    it.each(["MANAGER", "EMPLOYEE"] as const)("%s can't deactivate a site", async (role) => {
      const { company, token: hrToken } = await setUp();
      const token = await loginInCompany(company, role, "EMP-900");
      const site = await createSite(hrToken);

      expect((await setStatus(token, site.id, false)).status).toBe(403);
    });
  });

  describe("delete", () => {
    afterEach(async () => {
      await platformPrisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "_test_site_reference"`);
    });

    it("deletes an unused site and audits it", async () => {
      const { company, token } = await setUp();
      const site = await createSite(token);

      const res = await request(app).delete(`/api/v1/sites/${site.id}`).set("Authorization", token);

      expect(res.status).toBe(204);
      expect(await platformPrisma.site.count({ where: { id: site.id } })).toBe(0);
      const [audit] = await audits(company.id, "SITE_DELETED");
      expect(audit).toMatchObject({ entityId: site.id, metadata: { name: OFFICE.name } });
    });

    it("answers 409 SITE_IN_USE when a row references the site, and keeps it", async () => {
      const { company, token } = await setUp();
      const site = await createSite(token);
      // No real table references sites until step 2.3, so this stands in for
      // one, with the same kind of foreign key those tables will have.
      await platformPrisma.$executeRawUnsafe(
        `CREATE TABLE "_test_site_reference" ("siteId" TEXT NOT NULL REFERENCES "sites"("id") ON DELETE RESTRICT)`,
      );
      await platformPrisma.$executeRawUnsafe(`INSERT INTO "_test_site_reference" VALUES ('${site.id}')`);

      const res = await request(app).delete(`/api/v1/sites/${site.id}`).set("Authorization", token);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SITE_IN_USE");
      expect(await platformPrisma.site.count({ where: { id: site.id } })).toBe(1);
      expect(await audits(company.id, "SITE_DELETED")).toHaveLength(0);
    });

    it.each(["MANAGER", "EMPLOYEE"] as const)("%s can't delete a site", async (role) => {
      const { company, token: hrToken } = await setUp();
      const token = await loginInCompany(company, role, "EMP-900");
      const site = await createSite(hrToken);

      const res = await request(app).delete(`/api/v1/sites/${site.id}`).set("Authorization", token);

      expect(res.status).toBe(403);
      expect(await platformPrisma.site.count({ where: { id: site.id } })).toBe(1);
    });
  });

  describe("tenant isolation", () => {
    it("company B can't read, edit, deactivate or delete company A's site: 404, nothing changes", async () => {
      const a = await setUp();
      const b = await setUp();
      const site = await createSite(a.token);
      const url = `/api/v1/sites/${site.id}`;

      const read = await request(app).get(url).set("Authorization", b.token);
      const edit = await request(app).patch(url).set("Authorization", b.token).send({ name: "Hacked" });
      const status = await request(app).patch(`${url}/status`).set("Authorization", b.token).send({ isActive: false });
      const del = await request(app).delete(url).set("Authorization", b.token);

      expect([read.status, edit.status, status.status, del.status]).toEqual([404, 404, 404, 404]);

      const row = await platformPrisma.site.findUniqueOrThrow({ where: { id: site.id } });
      expect(row).toMatchObject({ name: OFFICE.name, isActive: true });
      const bAudits = await platformPrisma.auditLog.count({ where: { companyId: b.company.id, entityType: "Site" } });
      expect(bAudits).toBe(0);
    });

    it("lists only the caller's sites, whatever the query string says", async () => {
      const a = await setUp();
      const b = await setUp();
      await createSite(a.token);

      const res = await request(app).get(`/api/v1/sites?companyId=${a.company.id}`).set("Authorization", b.token);

      expect(res.body.total).toBe(0);
      expect(res.body.data).toEqual([]);
    });

    it("creates the site in the caller's company, even with another company's id in the body", async () => {
      const a = await setUp();
      const b = await setUp();

      const res = await post(a.token, { ...OFFICE, companyId: b.company.id });

      expect(res.status).toBe(201);
      const row = await platformPrisma.site.findUniqueOrThrow({ where: { id: res.body.site.id } });
      expect(row.companyId).toBe(a.company.id);
      expect(await platformPrisma.site.count({ where: { companyId: b.company.id } })).toBe(0);
    });

    it("uses the caller's company's defaults, not another's", async () => {
      const a = await setUp();
      const b = await setUp();
      await platformPrisma.companySettings.update({ where: { companyId: b.company.id }, data: { gpsRadiusMeters: 999 } });

      const res = await post(a.token, { name: "Yard", type: "EXTERNAL" });

      expect(res.body.site.radiusMeters).toBe(200);
    });
  });

  describe("module gate", () => {
    const ID = "00000000-0000-4000-8000-000000000000";
    const ROUTES: [string, (token: string) => request.Test][] = [
      ["GET /sites", (t) => request(app).get("/api/v1/sites").set("Authorization", t)],
      ["GET /sites/:id", (t) => request(app).get(`/api/v1/sites/${ID}`).set("Authorization", t)],
      ["POST /sites", (t) => post(t, OFFICE)],
      ["PATCH /sites/:id", (t) => request(app).patch(`/api/v1/sites/${ID}`).set("Authorization", t).send({ name: "X" })],
      [
        "PATCH /sites/:id/status",
        (t) => request(app).patch(`/api/v1/sites/${ID}/status`).set("Authorization", t).send({ isActive: false }),
      ],
      ["DELETE /sites/:id", (t) => request(app).delete(`/api/v1/sites/${ID}`).set("Authorization", t)],
    ];

    it.each(ROUTES)("%s answers 403 MODULE_DISABLED for a company with the module off", async (_name, call) => {
      const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

      const res = await call(token);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("MODULE_DISABLED");
      expect(res.body.error.details).toEqual({ module: "sites" });
    });

    // One login for all the routes: the platform login is limited to 5 attempts
    // per process, so a login per route would trip it.
    it("answers 403 on every route for a SUPER_ADMIN, who has no company", async () => {
      await createTestUser({ companyId: null, role: "SUPER_ADMIN", email: "root@platform.test" });
      const login = await platformLoginAs(app, { email: "root@platform.test", password: "Passw0rd!", clientType: "mobile" });
      const token = `Bearer ${login.body.accessToken as string}`;

      for (const [, call] of ROUTES) {
        const res = await call(token);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("FORBIDDEN");
      }
    });

    it.each(ROUTES)("%s needs a login", async (_name, call) => {
      const res = await call("");
      expect(res.status).toBe(401);
    });

    it("hides existing sites when the module is switched off, and shows them again when it's back on", async () => {
      const { company, token } = await setUp();
      const site = await createSite(token);

      await setSitesModule(company.id, false);
      const off = await request(app).get(`/api/v1/sites/${site.id}`).set("Authorization", token);
      expect(off.status).toBe(403);
      expect(off.body.error.code).toBe("MODULE_DISABLED");

      await setSitesModule(company.id, true);
      const on = await request(app).get(`/api/v1/sites/${site.id}`).set("Authorization", token);
      expect(on.status).toBe(200);
    });

    it("needs the sites module specifically: another module being on doesn't open it", async () => {
      const { company, token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
      await platformPrisma.companySettings.update({
        where: { companyId: company.id },
        data: { enabledModules: { attendance: true, tasks: true } },
      });
      invalidateEnabledModulesCache(company.id);

      const res = await request(app).get("/api/v1/sites").set("Authorization", token);

      expect(res.status).toBe(403);
    });
  });

  describe("database constraints (the last line of defence behind the API schema)", () => {
    async function row() {
      const company = await createTestCompany();
      const { user } = await createTestUser({ companyId: company.id, role: "COMPANY_ADMIN", email: "a@example.test" });
      return { companyId: company.id, createdByUserId: user.id, name: "Site", type: "EXTERNAL" as const, radiusMeters: 200, gpsRequired: false };
    }

    it.each([
      [{ radiusMeters: 24 }],
      [{ radiusMeters: 5001 }],
      [{ latitude: 91, longitude: 0 }],
      [{ latitude: 0, longitude: 181 }],
      [{ latitude: 6.9 }],
      [{ longitude: 79.8 }],
      [{ gpsRequired: true }],
    ])("rejects %j", async (data) => {
      await expect(platformPrisma.site.create({ data: { ...(await row()), ...data } })).rejects.toThrow();
    });

    it("rejects a case-insensitive duplicate name in the same company", async () => {
      const base = await row();
      await platformPrisma.site.create({ data: base });
      await expect(platformPrisma.site.create({ data: { ...base, name: "SITE" } })).rejects.toThrow();
    });
  });
});
