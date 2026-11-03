import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createEmployeeWithLogin, getLeaveTypeIdByCode, setUpCompanyWithUser } from "../../test/helpers.js";
import { TEST_TIMEZONES, useProcessTimezone } from "../../test/timezone.js";

// The API must decide "today" (and "this year") in the company's timezone
// (companies.timezone - Asia/Colombo by default), never the server's. Each
// suite runs twice: once with the server process in Colombo, once in UTC
// (how most cloud hosts run). The answers must be identical.

describe.each(TEST_TIMEZONES)("company-timezone 'today' (server TZ=$tz)", ({ tz, offsetMinutes }) => {
  useProcessTimezone(tz, offsetMinutes);

  describe("just after local midnight: 00:15 Tue 6 Jan 2026 in Colombo = 18:45 Mon 5 Jan UTC", () => {
    beforeAll(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-05T18:45:00.000Z"));
    });
    afterAll(() => vi.useRealTimers());

    it("accepts a leave starting today (Colombo) and counts its working days from Tuesday", async () => {
      const app = createApp();
      const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
      const { token } = await createEmployeeWithLogin(app, adminToken, company.code, {
        firstName: "Early",
        email: "early@example.test",
      });
      const annualId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

      const preview = await request(app)
        .post("/api/v1/leave-requests/preview")
        .set("Authorization", token)
        .send({ startDate: "2026-01-06", endDate: "2026-01-10" });
      expect(preview.status).toBe(200);
      expect(preview.body.totalDays).toBe(4.5); // Tue-Fri + Sat half

      const res = await request(app)
        .post("/api/v1/leave-requests")
        .set("Authorization", token)
        .send({ leaveTypeId: annualId, startDate: "2026-01-06", endDate: "2026-01-10" });
      expect(res.status).toBe(201);
      expect(res.body.leaveRequest.startDate).toBe("2026-01-06");
      expect(res.body.leaveRequest.totalDays).toBe(4.5);
    });

    it("rejects yesterday (Colombo) as a past date, even though it is still that date in UTC", async () => {
      const app = createApp();
      const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
      const { token } = await createEmployeeWithLogin(app, adminToken, company.code, {
        firstName: "Late",
        email: "late@example.test",
      });
      const annualId = await getLeaveTypeIdByCode(app, adminToken, "ANNUAL");

      const res = await request(app)
        .post("/api/v1/leave-requests")
        .set("Authorization", token)
        .send({ leaveTypeId: annualId, startDate: "2026-01-05", endDate: "2026-01-05" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("PAST_DATE_NOT_ALLOWED");
    });

    it("sets the sick-leave proof deadline to start date + 3 calendar days", async () => {
      const app = createApp();
      const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
      const { token } = await createEmployeeWithLogin(app, adminToken, company.code, {
        firstName: "Sick",
        email: "sick@example.test",
      });
      const sickId = await getLeaveTypeIdByCode(app, adminToken, "SICK");

      const res = await request(app)
        .post("/api/v1/leave-requests")
        .set("Authorization", token)
        .send({ leaveTypeId: sickId, startDate: "2026-01-06", endDate: "2026-01-06" });
      expect(res.status).toBe(201);
      expect(res.body.leaveRequest.proofDueAt.slice(0, 10)).toBe("2026-01-09");
    });
  });

  describe("new year: 00:15 on 1 Jan 2026 in Colombo = 18:45 on 31 Dec 2025 UTC", () => {
    beforeAll(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2025-12-31T18:45:00.000Z"));
    });
    afterAll(() => vi.useRealTimers());

    it("seeds and returns the company's current year (2026) balances, not the UTC year's", async () => {
      const app = createApp();
      const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
      const { token } = await createEmployeeWithLogin(app, adminToken, company.code, {
        firstName: "NewYear",
        email: "newyear@example.test",
      });

      const res = await request(app).get("/api/v1/leave-balances/me").set("Authorization", token);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const balance of res.body.data) {
        expect(balance.year).toBe(2026);
      }
    });
  });
});
