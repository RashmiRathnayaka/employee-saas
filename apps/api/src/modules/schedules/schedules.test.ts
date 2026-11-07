import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { EmployeeScheduleResponseSchema, MyScheduleResponseSchema } from "@employee-saas/shared";
import { createApp } from "../../app.js";
import { invalidateEnabledModulesCache } from "../../lib/enabledModules.js";
import { platformPrisma } from "../../lib/prisma.js";
import { createTestCompany, createTestUser, DEFAULT_TEST_PASSWORD, platformLoginAs } from "../../test/helpers.js";
import { TEST_TIMEZONES, useProcessTimezone } from "../../test/timezone.js";

const app = createApp();

/** A time on the wall clock in Colombo. 3 Nov 2026 is a Tuesday, the 7th a Saturday and
 * the 8th a Sunday. The company's default is 09:00-17:00 with 10 minutes' grace. */
const colombo = (date: string, time: string) => new Date(`2026-11-${date}T${time}+05:30`);
const TUESDAY_MORNING = colombo("03", "08:00:00");

type Person = { email: string; companyCode: string; employeeId: string; userId: string };
type Company = { id: string; code: string };
const tokens = new Map<string, string>();

async function at(person: Person, when: Date) {
  vi.setSystemTime(when);
  const key = `${person.email}|${Math.floor(when.getTime() / 600_000)}`;
  let token = tokens.get(key);
  if (!token) {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Client", "mobile")
      .send({ companyCode: person.companyCode, identifier: person.email, password: DEFAULT_TEST_PASSWORD });
    expect(res.status).toBe(200);
    token = `Bearer ${res.body.accessToken as string}`;
    tokens.set(key, token);
  }
  return token;
}

async function setUpCompany(modules: Record<string, boolean> = { attendance: true }) {
  const company = await createTestCompany();
  await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { enabledModules: modules } });
  invalidateEnabledModulesCache(company.id);
  return company;
}

async function addPerson(
  company: Company,
  role: "EMPLOYEE" | "MANAGER" | "HR" | "COMPANY_ADMIN" = "EMPLOYEE",
  options: { managerId?: string; profile?: boolean } = {},
): Promise<Person> {
  const suffix = crypto.randomBytes(3).toString("hex");
  const email = `${role.toLowerCase()}-${suffix}@example.test`;
  const { user, employeeId } = await createTestUser({
    companyId: company.id,
    role,
    email,
    employeeCode: options.profile === false ? undefined : `E${suffix}`,
  });
  if (options.managerId) {
    await platformPrisma.employee.update({ where: { id: employeeId! }, data: { managerId: options.managerId } });
  }
  return { email, companyCode: company.code, employeeId: employeeId!, userId: user.id };
}

async function setUp(modules?: Record<string, boolean>) {
  const company = await setUpCompany(modules);
  const hr = await addPerson(company, "HR");
  const manager = await addPerson(company, "MANAGER");
  const alex = await addPerson(company, "EMPLOYEE", { managerId: manager.employeeId });
  const sam = await addPerson(company);
  return { company, hr, manager, alex, sam };
}

const scheduleOf = (employeeId: string) => `/api/v1/employees/${employeeId}/schedule`;
const NIGHT = { startTime: "22:00", endTime: "06:00" };

function put(token: string, employeeId: string, body: object = NIGHT) {
  return request(app).put(scheduleOf(employeeId)).set("Authorization", token).send(body);
}
function getSchedule(token: string, employeeId: string) {
  return request(app).get(scheduleOf(employeeId)).set("Authorization", token);
}
function getMine(token: string) {
  return request(app).get("/api/v1/schedule/me").set("Authorization", token);
}
function checkIn(token: string) {
  return request(app).post("/api/v1/attendance/check-in").set("Authorization", token).send({ clientRequestId: crypto.randomUUID() });
}
function checkOut(token: string) {
  return request(app).post("/api/v1/attendance/check-out").set("Authorization", token).send({});
}

function setOverride(company: Company, person: Person, values: { startTime: string; endTime: string; lateGraceMinutes?: number; workingDays?: object }) {
  return platformPrisma.employeeSchedule.create({ data: { companyId: company.id, employeeId: person.employeeId, ...values } });
}
const auditsOf = (company: Company, action: string) => platformPrisma.auditLog.findMany({ where: { companyId: company.id, action } });

describe("schedules module", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TUESDAY_MORNING);
    tokens.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("access", () => {
    const CALLS = [
      ["GET", "/schedule/me"],
      ["GET", "/employees/ID/schedule"],
      ["PUT", "/employees/ID/schedule"],
      ["DELETE", "/employees/ID/schedule"],
    ] as const;

    function call(method: (typeof CALLS)[number][0], path: string, token?: string) {
      const url = `/api/v1${path}`;
      const req = method === "GET" ? request(app).get(url) : method === "PUT" ? request(app).put(url) : request(app).delete(url);
      if (token) req.set("Authorization", token);
      return method === "PUT" ? req.send(NIGHT) : req;
    }

    it.each(CALLS)("%s %s answers MODULE_DISABLED with attendance off", async (method, path) => {
      const { hr, alex } = await setUp({ sites: true });

      const res = await call(method, path.replace("ID", alex.employeeId), await at(hr, TUESDAY_MORNING));

      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({ code: "MODULE_DISABLED", details: { module: "attendance" } });
      expect(await platformPrisma.employeeSchedule.count()).toBe(0);
    });

    it.each(CALLS)("%s %s needs a login", async (method, path) => {
      expect((await call(method, path.replace("ID", crypto.randomUUID()))).status).toBe(401);
    });

    it.each(CALLS)("%s %s is closed to SUPER_ADMIN", async (method, path) => {
      const email = `root-${crypto.randomBytes(3).toString("hex")}@example.test`;
      const { password } = await createTestUser({ companyId: null, role: "SUPER_ADMIN", email });
      const login = await platformLoginAs(app, { email, password, clientType: "mobile" });

      const res = await call(method, path.replace("ID", crypto.randomUUID()), `Bearer ${login.body.accessToken as string}`);

      expect(res.status).toBe(403);
    });

    it("the employee endpoints themselves aren't gated by the attendance module", async () => {
      const { hr, alex } = await setUp({});
      const res = await request(app).get(`/api/v1/employees/${alex.employeeId}`).set("Authorization", await at(hr, TUESDAY_MORNING));
      expect(res.status).toBe(200);
    });

    it("/schedule/me needs an employee profile", async () => {
      const company = await setUpCompany();
      const admin = await addPerson(company, "COMPANY_ADMIN", { profile: false });

      const res = await getMine(await at(admin, TUESDAY_MORNING));

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("NO_EMPLOYEE_PROFILE");
    });

    it("a plain employee can't read anyone's schedule by id, even their own", async () => {
      const { alex, sam } = await setUp();
      const token = await at(alex, TUESDAY_MORNING);

      expect((await getSchedule(token, sam.employeeId)).status).toBe(403);
      expect((await getSchedule(token, alex.employeeId)).status).toBe(403);
    });

    it.each(["EMPLOYEE", "MANAGER"] as const)("%s can't set or remove an override", async (role) => {
      const { company, alex, manager } = await setUp();
      const caller = role === "MANAGER" ? manager : await addPerson(company, role);
      const token = await at(caller, TUESDAY_MORNING);

      expect((await put(token, alex.employeeId)).status).toBe(403);
      expect((await request(app).delete(scheduleOf(alex.employeeId)).set("Authorization", token)).status).toBe(403);
      expect(await platformPrisma.employeeSchedule.count()).toBe(0);
    });

    describe("a manager", () => {
      it("sees their direct report's schedule", async () => {
        const { manager, alex } = await setUp();
        const res = await getSchedule(await at(manager, TUESDAY_MORNING), alex.employeeId);
        expect(res.status).toBe(200);
      });

      it("gets 404 for someone outside the team", async () => {
        const { manager, sam } = await setUp();
        const res = await getSchedule(await at(manager, TUESDAY_MORNING), sam.employeeId);
        expect(res.status).toBe(404);
      });
    });

    describe("across companies", () => {
      it("another company's employee is a 404 for every call, and nothing changes", async () => {
        const { hr } = await setUp();
        const other = await setUp();
        await setOverride(other.company, other.alex, NIGHT);
        const token = await at(hr, TUESDAY_MORNING);

        expect((await getSchedule(token, other.alex.employeeId)).status).toBe(404);
        expect((await put(token, other.alex.employeeId, { startTime: "08:00", endTime: "16:00" })).status).toBe(404);
        expect((await request(app).delete(scheduleOf(other.alex.employeeId)).set("Authorization", token)).status).toBe(404);

        const row = await platformPrisma.employeeSchedule.findFirstOrThrow({ where: { employeeId: other.alex.employeeId } });
        expect(row.startTime).toBe("22:00");
      });

      it("a company id in the body is ignored", async () => {
        const { company, hr, alex } = await setUp();
        const other = await setUp();

        const res = await put(await at(hr, TUESDAY_MORNING), alex.employeeId, { ...NIGHT, companyId: other.company.id });

        expect(res.status).toBe(200);
        const row = await platformPrisma.employeeSchedule.findFirstOrThrow({ where: { employeeId: alex.employeeId } });
        expect(row.companyId).toBe(company.id);
      });
    });
  });

  describe("PUT and DELETE /employees/:id/schedule", () => {
    it.each(["HR", "COMPANY_ADMIN"] as const)("%s sets an override, audited with what changed", async (role) => {
      const { company, alex } = await setUp();
      const caller = await addPerson(company, role, { profile: false });

      const res = await put(await at(caller, TUESDAY_MORNING), alex.employeeId, { ...NIGHT, lateGraceMinutes: 5 });

      expect(res.status).toBe(200);
      expect(EmployeeScheduleResponseSchema.parse(res.body).schedule).toMatchObject({ source: "OVERRIDE", startTime: "22:00", endTime: "06:00", lateGraceMinutes: 5 });
      expect(res.body.override).toMatchObject({ startTime: "22:00", lateGraceMinutes: 5, workingDays: null });

      const [audit] = await auditsOf(company, "SCHEDULE_UPDATED");
      expect(audit).toMatchObject({ entityType: "Employee", entityId: alex.employeeId, actorUserId: caller.userId });
      expect(audit!.metadata).toMatchObject({ before: { startTime: null }, after: { startTime: "22:00", endTime: "06:00", lateGraceMinutes: 5 } });
    });

    it.each(["HR", "COMPANY_ADMIN"] as const)("%s can't set or remove their own schedule, but a colleague can", async (role) => {
      const { company, hr } = await setUp();
      const caller = await addPerson(company, role);
      const token = await at(caller, TUESDAY_MORNING);
      const overrides = () => platformPrisma.employeeSchedule.count({ where: { employeeId: caller.employeeId } });

      const setOwn = await put(token, caller.employeeId);
      expect(setOwn.status).toBe(400);
      expect(setOwn.body.error.code).toBe("CANNOT_SET_OWN_SCHEDULE");
      expect(await overrides()).toBe(0);
      expect(await auditsOf(company, "SCHEDULE_UPDATED")).toHaveLength(0);

      const byColleague = await put(await at(hr, TUESDAY_MORNING), caller.employeeId);
      expect(byColleague.status).toBe(200);

      const removeOwn = await request(app).delete(scheduleOf(caller.employeeId)).set("Authorization", token);
      expect(removeOwn.status).toBe(400);
      expect(removeOwn.body.error.code).toBe("CANNOT_SET_OWN_SCHEDULE");
      expect(await overrides()).toBe(1);
      expect(await auditsOf(company, "SCHEDULE_REMOVED")).toHaveLength(0);
    });

    it("a second PUT replaces the first, and a field left out follows the company again", async () => {
      const { hr, alex } = await setUp();
      const token = await at(hr, TUESDAY_MORNING);
      const week = { mon: "FULL", tue: "FULL", wed: "FULL", thu: "FULL", fri: "OFF", sat: "OFF", sun: "OFF" };
      await put(token, alex.employeeId, { ...NIGHT, lateGraceMinutes: 5, workingDays: week });

      const res = await put(token, alex.employeeId, { startTime: "08:00", endTime: "16:00" });

      expect(res.body.override).toMatchObject({ startTime: "08:00", lateGraceMinutes: null, workingDays: null });
      expect(res.body.schedule).toMatchObject({ lateGraceMinutes: 10, workingDays: { fri: "FULL", sun: "OFF" } });
      expect(await platformPrisma.employeeSchedule.count({ where: { employeeId: alex.employeeId } })).toBe(1);
    });

    it("saving the same values leaves no audit row", async () => {
      const { company, hr, alex } = await setUp();
      const token = await at(hr, TUESDAY_MORNING);
      await put(token, alex.employeeId);

      const res = await put(token, alex.employeeId);

      expect(res.status).toBe(200);
      expect(await auditsOf(company, "SCHEDULE_UPDATED")).toHaveLength(1);
    });

    it.each([
      ["a shift over 16 hours", { startTime: "06:00", endTime: "23:00" }, "endTime"],
      ["a shift under an hour", { startTime: "09:00", endTime: "09:30" }, "endTime"],
      ["a malformed time", { startTime: "9am", endTime: "17:00" }, "startTime"],
      ["too much grace", { ...NIGHT, lateGraceMinutes: 241 }, "lateGraceMinutes"],
      ["half a week", { ...NIGHT, workingDays: { mon: "FULL" } }, "workingDays"],
    ])("refuses %s, on that field", async (_name, body, field) => {
      const { hr, alex } = await setUp();

      const res = await put(await at(hr, TUESDAY_MORNING), alex.employeeId, body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.fieldErrors[field]).toBeTruthy();
      expect(await platformPrisma.employeeSchedule.count()).toBe(0);
    });

    it("DELETE goes back to the company's hours, audited", async () => {
      const { company, hr, alex } = await setUp();
      const token = await at(hr, TUESDAY_MORNING);
      await put(token, alex.employeeId);

      const res = await request(app).delete(scheduleOf(alex.employeeId)).set("Authorization", token);

      expect(res.status).toBe(204);
      const after = await getSchedule(token, alex.employeeId);
      expect(after.body).toMatchObject({ override: null, schedule: { source: "COMPANY", startTime: "09:00", endTime: "17:00" } });
      const [audit] = await auditsOf(company, "SCHEDULE_REMOVED");
      expect(audit!.metadata).toMatchObject({ before: { startTime: "22:00" } });
    });

    it("DELETE with no override is a quiet 204, with no audit row", async () => {
      const { company, hr, alex } = await setUp();

      const res = await request(app).delete(scheduleOf(alex.employeeId)).set("Authorization", await at(hr, TUESDAY_MORNING));

      expect(res.status).toBe(204);
      expect(await auditsOf(company, "SCHEDULE_REMOVED")).toHaveLength(0);
    });

    it("two overrides can't exist for one employee, even at the same moment", async () => {
      const { hr, alex } = await setUp();
      const token = await at(hr, TUESDAY_MORNING);

      await Promise.allSettled([put(token, alex.employeeId), put(token, alex.employeeId, { startTime: "08:00", endTime: "16:00" })]);

      expect(await platformPrisma.employeeSchedule.count({ where: { employeeId: alex.employeeId } })).toBe(1);
    });
  });

  // The server's own timezone must never matter.
  describe.each(TEST_TIMEZONES)("GET /schedule/me with server TZ=$tz", ({ tz, offsetMinutes }) => {
    useProcessTimezone(tz, offsetMinutes);

    it("the company's hours, for today and the next 13 days, in company time", async () => {
      const { alex } = await setUp();

      const res = await getMine(await at(alex, TUESDAY_MORNING));

      expect(res.status).toBe(200);
      const { schedule, days } = MyScheduleResponseSchema.parse(res.body);
      expect(schedule).toMatchObject({ source: "COMPANY", startTime: "09:00", endTime: "17:00", lateGraceMinutes: 10 });
      expect(days).toHaveLength(14);
      expect(days[0]).toMatchObject({
        date: "2026-11-03",
        dayType: "WORKING",
        scheduledStartAt: colombo("03", "09:00:00").toISOString(),
        scheduledEndAt: colombo("03", "17:00:00").toISOString(),
      });
      expect(days.at(-1)!.date).toBe("2026-11-16");
    });

    it("starts from the company's date, just after midnight there", async () => {
      const { alex } = await setUp();

      const res = await getMine(await at(alex, colombo("04", "00:10:00")));

      expect(res.body.days[0].date).toBe("2026-11-04");
    });

    it("names half days, weekly offs and holidays", async () => {
      const { company, alex } = await setUp();
      await platformPrisma.companyHoliday.create({ data: { companyId: company.id, date: new Date("2026-11-05"), name: "Poya" } });

      const { body } = await getMine(await at(alex, TUESDAY_MORNING));
      const day = (date: string) => body.days.find((d: { date: string }) => d.date === date);

      expect(day("2026-11-05")).toMatchObject({ dayType: "HOLIDAY", scheduledStartAt: null, scheduledEndAt: null });
      expect(day("2026-11-07")).toMatchObject({ dayType: "HALF", scheduledEndAt: colombo("07", "13:00:00").toISOString() });
      expect(day("2026-11-08")).toMatchObject({ dayType: "OFF", scheduledStartAt: null });
    });

    it("names approved leave, and half a day of it, from my leave only", async () => {
      const { company, alex, sam } = await setUp();
      const leaveType = await platformPrisma.leaveType.findFirstOrThrow({ where: { companyId: company.id } });
      const leave = (employeeId: string, start: string, end: string, status: "APPROVED" | "PENDING_MANAGER", endHalfDay = false) =>
        platformPrisma.leaveRequest.create({
          data: { companyId: company.id, employeeId, leaveTypeId: leaveType.id, startDate: new Date(start), endDate: new Date(end), endHalfDay, totalDays: 1, status },
        });
      await leave(alex.employeeId, "2026-11-10", "2026-11-11", "APPROVED", true);
      await leave(alex.employeeId, "2026-11-12", "2026-11-12", "PENDING_MANAGER");
      await leave(sam.employeeId, "2026-11-13", "2026-11-13", "APPROVED");

      const { body } = await getMine(await at(alex, TUESDAY_MORNING));
      const day = (date: string) => body.days.find((d: { date: string }) => d.date === date);

      expect(day("2026-11-10")).toMatchObject({ dayType: "ON_LEAVE", isHalfDayLeave: false });
      expect(day("2026-11-11")).toMatchObject({ dayType: "WORKING", isHalfDayLeave: true });
      expect(day("2026-11-12").dayType).toBe("WORKING");
      expect(day("2026-11-13").dayType).toBe("WORKING");
    });

    it("an override shows, and a night shift ends on the next day", async () => {
      const { company, alex } = await setUp();
      await setOverride(company, alex, NIGHT);

      const { body } = await getMine(await at(alex, TUESDAY_MORNING));

      expect(body.schedule).toMatchObject({ source: "OVERRIDE", startTime: "22:00", endTime: "06:00" });
      expect(body.days[0]).toMatchObject({
        scheduledStartAt: colombo("03", "22:00:00").toISOString(),
        scheduledEndAt: colombo("04", "06:00:00").toISOString(),
      });
    });

    it("another employee's override doesn't touch mine", async () => {
      const { company, alex, sam } = await setUp();
      await setOverride(company, sam, NIGHT);

      const { body } = await getMine(await at(alex, TUESDAY_MORNING));

      expect(body.schedule.source).toBe("COMPANY");
    });
  });

  describe("an override decides check-ins", () => {
    it("lateness is judged against the override, not the company's hours", async () => {
      const { company, alex } = await setUp();
      await setOverride(company, alex, { startTime: "11:00", endTime: "19:00" });

      const res = await checkIn(await at(alex, colombo("03", "10:30:00")));

      expect(res.body.record).toMatchObject({ status: "PRESENT", lateMinutes: 0 });
      expect(res.body.record.scheduledStartAt).toBe(colombo("03", "11:00:00").toISOString());
    });

    it("the override's grace applies, including none at all", async () => {
      const { company, alex } = await setUp();
      await setOverride(company, alex, { startTime: "09:00", endTime: "17:00", lateGraceMinutes: 0 });

      const res = await checkIn(await at(alex, colombo("03", "09:05:00")));

      expect(res.body.record).toMatchObject({ status: "LATE", lateMinutes: 5 });
    });

    it("the override's week applies: working on the company's day off", async () => {
      const { company, alex } = await setUp();
      const week = { mon: "OFF", tue: "OFF", wed: "FULL", thu: "FULL", fri: "FULL", sat: "FULL", sun: "FULL" };
      await setOverride(company, alex, { startTime: "09:00", endTime: "17:00", workingDays: week });

      const sunday = await checkIn(await at(alex, colombo("08", "09:30:00")));

      expect(sunday.body.record).toMatchObject({ status: "LATE" });
      expect(sunday.body.record.flags).not.toContain("NON_WORKING_DAY");
    });

    it("the override's week applies: off on the company's working day", async () => {
      const { company, alex } = await setUp();
      const week = { mon: "OFF", tue: "OFF", wed: "FULL", thu: "FULL", fri: "FULL", sat: "FULL", sun: "FULL" };
      await setOverride(company, alex, { startTime: "09:00", endTime: "17:00", workingDays: week });

      const tuesday = await checkIn(await at(alex, colombo("03", "09:30:00")));

      expect(tuesday.body.record.status).toBe("PRESENT");
      expect(tuesday.body.record.flags).toContain("NON_WORKING_DAY");
    });

    it("/attendance/me/today shows the override", async () => {
      const { company, alex } = await setUp();
      await setOverride(company, alex, NIGHT);

      const res = await request(app).get("/api/v1/attendance/me/today").set("Authorization", await at(alex, TUESDAY_MORNING));

      expect(res.body.schedule.scheduledStartAt).toBe(colombo("03", "22:00:00").toISOString());
      expect(res.body.schedule.scheduledEndAt).toBe(colombo("04", "06:00:00").toISOString());
    });

    describe("a night shift, 22:00-06:00", () => {
      it("a check-in after midnight belongs to the night before", async () => {
        const { company, alex } = await setUp();
        await setOverride(company, alex, NIGHT);

        const res = await checkIn(await at(alex, colombo("04", "00:20:00")));

        expect(res.body.record).toMatchObject({ workDate: "2026-11-03", status: "LATE", lateMinutes: 140 });
      });

      it("checks in before midnight, checks out the next morning, one record", async () => {
        const { company, alex } = await setUp();
        await setOverride(company, alex, NIGHT);

        const inRes = await checkIn(await at(alex, colombo("03", "21:50:00")));
        const outRes = await checkOut(await at(alex, colombo("04", "06:30:00")));

        expect(inRes.body.record).toMatchObject({ workDate: "2026-11-03", status: "PRESENT" });
        expect(outRes.body.record).toMatchObject({ id: inRes.body.record.id, workedMinutes: 520, earlyLeaveMinutes: 0 });
      });

      it("a Saturday night stays a full shift, not the company's half day", async () => {
        const { company, alex } = await setUp();
        await setOverride(company, alex, NIGHT);

        const res = await checkIn(await at(alex, colombo("07", "22:00:00")));

        expect(res.body.record.scheduledEndAt).toBe(colombo("08", "06:00:00").toISOString());
      });
    });

    it("changing a schedule later doesn't rewrite a past record", async () => {
      const { hr, alex } = await setUp();
      const before = await checkIn(await at(alex, colombo("03", "09:30:00")));
      expect(before.body.record).toMatchObject({ status: "LATE", lateMinutes: 30 });

      await put(await at(hr, colombo("03", "12:00:00")), alex.employeeId, { startTime: "10:00", endTime: "18:00" });

      const row = await platformPrisma.attendanceRecord.findUniqueOrThrow({ where: { id: before.body.record.id } });
      expect(row).toMatchObject({ status: "LATE", lateMinutes: 30, scheduledStartAt: colombo("03", "09:00:00") });
    });

    it("removing an override applies to the next check-in", async () => {
      const { hr, alex } = await setUp();
      await put(await at(hr, TUESDAY_MORNING), alex.employeeId);
      await request(app).delete(scheduleOf(alex.employeeId)).set("Authorization", await at(hr, TUESDAY_MORNING));

      const res = await checkIn(await at(alex, colombo("03", "09:00:00")));

      expect(res.body.record.scheduledStartAt).toBe(colombo("03", "09:00:00").toISOString());
    });
  });
});
