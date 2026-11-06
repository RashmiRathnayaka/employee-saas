import { describe, expect, it } from "vitest";
import request from "supertest";
import { CompanySettingsSchema } from "@employee-saas/shared";
import { createApp } from "../../app.js";
import { platformPrisma } from "../../lib/prisma.js";
import { createTestCompany, createTestUser, platformLoginAs, setUpCompanyWithUser } from "../../test/helpers.js";

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

  describe("Phase 2 settings", () => {
    const patchSettings = (app: ReturnType<typeof createApp>, token: string, body: unknown) =>
      request(app).patch("/api/v1/company/settings").set("Authorization", token).send(body as object);

    it("returns the documented defaults, with every module off", async () => {
      const app = createApp();
      const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

      const res = await request(app).get("/api/v1/company/settings").set("Authorization", token);

      expect(res.body.settings).toMatchObject({
        enabledModules: {},
        workStartTime: "09:00",
        workEndTime: "17:00",
        halfDayEndTime: "13:00",
        lateGraceMinutes: 10,
        autoCheckoutAfterMinutes: 240,
        checkinReminderEnabled: true,
        checkinReminderOffsetMinutes: 0,
        proofRemindersEnabled: true,
        dailyReminderTime: "09:00",
        gpsMaxAccuracyMeters: 100,
        gpsRetentionDays: 90,
      });
    });

    it("matches the shared response schema", async () => {
      const app = createApp();
      const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

      const res = await request(app).get("/api/v1/company/settings").set("Authorization", token);

      expect(CompanySettingsSchema.safeParse(res.body.settings).success).toBe(true);
    });

    it("saves every new field, and a later read returns them", async () => {
      const app = createApp();
      const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
      const values = {
        workStartTime: "08:30",
        workEndTime: "16:30",
        halfDayEndTime: "12:30",
        lateGraceMinutes: 15,
        autoCheckoutAfterMinutes: 60,
        checkinReminderEnabled: false,
        checkinReminderOffsetMinutes: 30,
        proofRemindersEnabled: false,
        dailyReminderTime: "10:00",
        gpsMaxAccuracyMeters: 50,
        gpsRetentionDays: 30,
      };

      const patchRes = await patchSettings(app, token, values);
      expect(patchRes.status).toBe(200);

      const getRes = await request(app).get("/api/v1/company/settings").set("Authorization", token);
      expect(getRes.body.settings).toMatchObject(values);
    });

    it("accepts a night-shift default, where the end is earlier than the start", async () => {
      const app = createApp();
      const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

      const res = await patchSettings(app, token, { workStartTime: "22:00", workEndTime: "06:00" });

      expect(res.status).toBe(200);
    });

    it.each([
      [{ workStartTime: "25:00" }],
      [{ workEndTime: "9am" }],
      [{ lateGraceMinutes: 241 }],
      [{ autoCheckoutAfterMinutes: 29 }],
      [{ checkinReminderOffsetMinutes: -1 }],
      [{ gpsMaxAccuracyMeters: 5 }],
      [{ gpsRetentionDays: 366 }],
      [{ enabledModules: { payroll: true } }],
    ])("rejects %j with 400 and changes nothing", async (body) => {
      const app = createApp();
      const { company, token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

      const res = await patchSettings(app, token, body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      const audits = await platformPrisma.auditLog.count({ where: { companyId: company.id, action: "COMPANY_SETTINGS_UPDATED" } });
      expect(audits).toBe(0);
    });

    it.each(["HR", "MANAGER", "EMPLOYEE"] as const)("forbids %s from changing modules or schedule", async (role) => {
      const app = createApp();
      const { company, token } = await setUpCompanyWithUser(app, { role, employeeCode: "EMP-001" });

      const moduleRes = await patchSettings(app, token, { enabledModules: { attendance: true } });
      const scheduleRes = await patchSettings(app, token, { workStartTime: "08:00" });

      expect(moduleRes.status).toBe(403);
      expect(scheduleRes.status).toBe(403);
      const settings = await platformPrisma.companySettings.findUniqueOrThrow({ where: { companyId: company.id } });
      expect(settings.enabledModules).toEqual({});
      expect(settings.workStartTime).toBe("09:00");
    });

    it("merges enabledModules: one switch doesn't touch the others", async () => {
      const app = createApp();
      const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

      await patchSettings(app, token, { enabledModules: { attendance: true, sites: true } });
      const res = await patchSettings(app, token, { enabledModules: { sites: false, tasks: true } });

      expect(res.body.settings.enabledModules).toEqual({ attendance: true, sites: false, tasks: true });
    });

    it("leaves enabledModules alone when a PATCH doesn't mention it", async () => {
      const app = createApp();
      const { token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

      await patchSettings(app, token, { enabledModules: { attendance: true } });
      const res = await patchSettings(app, token, { lateGraceMinutes: 20 });

      expect(res.body.settings.enabledModules).toEqual({ attendance: true });
    });

    it("audits only the fields that changed, with before and after", async () => {
      const app = createApp();
      const { company, user, token } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

      await patchSettings(app, token, {
        lateGraceMinutes: 25,
        workStartTime: "09:00", // sent, but the same as the current value
        enabledModules: { attendance: true },
      });

      const audit = await platformPrisma.auditLog.findFirstOrThrow({
        where: { companyId: company.id, action: "COMPANY_SETTINGS_UPDATED" },
      });
      expect(audit.actorUserId).toBe(user.id);
      expect(audit.entityType).toBe("CompanySettings");
      expect(audit.metadata).toEqual({
        before: { lateGraceMinutes: 10, enabledModules: {} },
        after: { lateGraceMinutes: 25, enabledModules: { attendance: true } },
      });
    });

    describe("tenant isolation", () => {
      it("changes only the caller's company, even with another company's id in the body", async () => {
        const app = createApp();
        const a = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
        const b = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });

        const res = await patchSettings(app, a.token, {
          companyId: b.company.id,
          lateGraceMinutes: 33,
          enabledModules: { attendance: true },
        });

        expect(res.status).toBe(200);
        expect(res.body.settings.companyId).toBe(a.company.id);
        const bSettings = await platformPrisma.companySettings.findUniqueOrThrow({ where: { companyId: b.company.id } });
        expect(bSettings.lateGraceMinutes).toBe(10);
        expect(bSettings.enabledModules).toEqual({});
        const bAudits = await platformPrisma.auditLog.count({ where: { companyId: b.company.id, action: "COMPANY_SETTINGS_UPDATED" } });
        expect(bAudits).toBe(0);
      });

      it("reads only the caller's company, whatever the query string says", async () => {
        const app = createApp();
        const a = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
        const b = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
        await patchSettings(app, b.token, { lateGraceMinutes: 44 });

        const res = await request(app).get(`/api/v1/company/settings?companyId=${b.company.id}`).set("Authorization", a.token);

        expect(res.body.settings.companyId).toBe(a.company.id);
        expect(res.body.settings.lateGraceMinutes).toBe(10);
      });
    });

    describe("database constraints (the last line of defence behind the API schema)", () => {
      it.each([
        [{ workStartTime: "25:00" }],
        [{ workEndTime: "9:00" }],
        [{ halfDayEndTime: "" }],
        [{ dailyReminderTime: "09:00:00" }],
        [{ lateGraceMinutes: 241 }],
        [{ autoCheckoutAfterMinutes: 721 }],
        [{ checkinReminderOffsetMinutes: 121 }],
        [{ gpsMaxAccuracyMeters: 9 }],
        [{ gpsRetentionDays: 29 }],
      ])("rejects %j", async (data) => {
        const company = await createTestCompany();
        await expect(platformPrisma.companySettings.update({ where: { companyId: company.id }, data })).rejects.toThrow();
      });
    });
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
