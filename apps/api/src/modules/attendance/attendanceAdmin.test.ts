import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { AttendanceListRowSchema, AttendanceRecordDetailSchema, SiteVisitDetailSchema } from "@employee-saas/shared";
import { createApp } from "../../app.js";
import { invalidateEnabledModulesCache } from "../../lib/enabledModules.js";
import { platformPrisma } from "../../lib/prisma.js";
import { createTestCompany, createTestUser, DEFAULT_TEST_PASSWORD, platformLoginAs } from "../../test/helpers.js";
import { TEST_TIMEZONES, useProcessTimezone } from "../../test/timezone.js";

const app = createApp();

/** A time on the wall clock in Colombo. 3 Nov 2026 is a Tuesday and the 8th a Sunday.
 * The default schedule is 09:00-17:00, with 10 minutes' grace, and closes at 21:00. */
const colombo = (date: string, time: string) => new Date(`2026-11-${date}T${time}+05:30`);
const iso = (date: string, time: string) => colombo(date, time).toISOString();
const NOW = colombo("03", "18:00:00");
const LATER_DAY = colombo("05", "12:00:00");
const REASON = "Forgot to tap on arrival";

type Person = { email: string; companyCode: string; employeeId: string; userId: string };
type Company = { id: string; code: string };
const tokens = new Map<string, string>();

async function at(person: Person, when: Date = NOW) {
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

async function setUpCompany(modules: Record<string, boolean> = { attendance: true, sites: true }) {
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

/** A record the way a check-in writes it, without going through the phone. */
function addRecord(company: Company, person: Person, overrides: Record<string, unknown> = {}) {
  return platformPrisma.attendanceRecord.create({
    data: {
      companyId: company.id,
      employeeId: person.employeeId,
      workDate: new Date("2026-11-03"),
      status: "LATE",
      lateMinutes: 30,
      scheduledStartAt: colombo("03", "09:00:00"),
      scheduledEndAt: colombo("03", "17:00:00"),
      checkInAt: colombo("03", "09:30:00"),
      source: "MOBILE",
      ...overrides,
    },
  });
}

/** A row the way the day close job (step 2.7) will write it. */
function systemRow(company: Company, person: Person, status: "ABSENT" | "ON_LEAVE" | "HOLIDAY", workDate = "2026-11-03") {
  return platformPrisma.attendanceRecord.create({
    data: { companyId: company.id, employeeId: person.employeeId, workDate: new Date(workDate), status, source: "SYSTEM" },
  });
}

async function addSite(company: Company, extra: object = {}) {
  const owner = (await platformPrisma.user.findFirstOrThrow({ where: { companyId: company.id } })).id;
  return platformPrisma.site.create({
    data: {
      companyId: company.id,
      createdByUserId: owner,
      name: `Site ${crypto.randomBytes(2).toString("hex")}`,
      type: "EXTERNAL",
      radiusMeters: 200,
      gpsRequired: false,
      ...extra,
    },
  });
}

async function addVisit(company: Company, person: Person, overrides: Record<string, unknown> = {}) {
  const site = await addSite(company);
  return platformPrisma.siteVisit.create({
    data: {
      companyId: company.id,
      employeeId: person.employeeId,
      siteId: site.id,
      workDate: new Date("2026-11-03"),
      status: "CLOSED",
      checkInAt: colombo("03", "10:00:00"),
      checkOutAt: colombo("03", "11:00:00"),
      durationMinutes: 60,
      clientRequestId: crypto.randomUUID(),
      ...overrides,
    },
    include: { site: true },
  });
}

const get = (token: string, path: string) => request(app).get(`/api/v1${path}`).set("Authorization", token);
const patch = (token: string, recordId: string, body: object) =>
  request(app).patch(`/api/v1/attendance/${recordId}/correct`).set("Authorization", token).send(body);
const post = (token: string, body: object) => request(app).post("/api/v1/attendance").set("Authorization", token).send(body);
const patchVisit = (token: string, visitId: string, body: object) =>
  request(app).patch(`/api/v1/site-visits/${visitId}/correct`).set("Authorization", token).send(body);

const noticesOf = (person: Person) => platformPrisma.notification.findMany({ where: { userId: person.userId } });
const auditsOf = (company: Company, action: string) => platformPrisma.auditLog.findMany({ where: { companyId: company.id, action } });
const rowOf = (id: string) => platformPrisma.attendanceRecord.findUniqueOrThrow({ where: { id } });
const correctionsOf = (id: string) => platformPrisma.attendanceCorrection.findMany({ where: { attendanceRecordId: id } });

const COORDINATE_FIELDS = ["checkInLat", "checkInLng", "checkOutLat", "checkOutLng"];

describe("HR attendance", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    tokens.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("access", () => {
    const ID = "11111111-1111-4111-8111-111111111111";
    const CALLS = [
      ["GET", "/attendance"],
      ["GET", "/attendance/team"],
      ["POST", "/attendance"],
      ["PATCH", `/attendance/${ID}/correct`],
    ] as const;

    function call(method: "GET" | "POST" | "PATCH", path: string, token?: string) {
      const url = `/api/v1${path}`;
      const req = method === "GET" ? request(app).get(url) : method === "POST" ? request(app).post(url) : request(app).patch(url);
      if (token) req.set("Authorization", token);
      return method === "GET" ? req : req.send({ checkInAt: iso("03", "08:55:00"), employeeId: ID, workDate: "2026-11-03", reason: REASON });
    }

    it.each(CALLS)("%s %s answers MODULE_DISABLED with attendance off", async (method, path) => {
      const { hr } = await setUp({ sites: true });

      const res = await call(method, path, await at(hr));

      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({ code: "MODULE_DISABLED", details: { module: "attendance" } });
    });

    it("PATCH /site-visits/:id/correct answers MODULE_DISABLED with sites off", async () => {
      const { hr } = await setUp({ attendance: true });

      const res = await patchVisit(await at(hr), ID, { checkInAt: iso("03", "10:00:00"), reason: REASON });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({ code: "MODULE_DISABLED", details: { module: "sites" } });
    });

    it.each(CALLS)("%s %s needs a login", async (method, path) => {
      expect((await call(method, path)).status).toBe(401);
    });

    it.each(CALLS)("%s %s is closed to SUPER_ADMIN", async (method, path) => {
      const email = `root-${crypto.randomBytes(3).toString("hex")}@example.test`;
      const { password } = await createTestUser({ companyId: null, role: "SUPER_ADMIN", email });
      const login = await platformLoginAs(app, { email, password, clientType: "mobile" });

      expect((await call(method, path, `Bearer ${login.body.accessToken as string}`)).status).toBe(403);
    });

    it.each(CALLS)("%s %s is closed to a plain employee", async (method, path) => {
      const { alex } = await setUp();
      expect((await call(method, path, await at(alex))).status).toBe(403);
    });

    it("a manager can't list everyone, correct or create", async () => {
      const { company, manager, alex } = await setUp();
      const record = await addRecord(company, alex);
      const visit = await addVisit(company, alex);
      const token = await at(manager);

      expect((await get(token, "/attendance")).status).toBe(403);
      expect((await patch(token, record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON })).status).toBe(403);
      expect((await post(token, { employeeId: alex.employeeId, workDate: "2026-11-02", checkInAt: iso("02", "09:00:00"), reason: REASON })).status).toBe(403);
      expect((await patchVisit(token, visit.id, { checkInAt: iso("03", "09:55:00"), reason: REASON })).status).toBe(403);
      expect(await rowOf(record.id)).toMatchObject({ isCorrected: false });
    });

    it.each(["HR", "COMPANY_ADMIN"] as const)("%s isn't given the team list", async (role) => {
      const { company } = await setUp();
      const person = await addPerson(company, role);
      expect((await get(await at(person), "/attendance/team")).status).toBe(403);
    });

    it("a manager with no employee profile has no team", async () => {
      const company = await setUpCompany();
      const manager = await addPerson(company, "MANAGER", { profile: false });

      const res = await get(await at(manager), "/attendance/team");

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("NO_EMPLOYEE_PROFILE");
    });
  });

  describe("GET /attendance", () => {
    it.each(["HR", "COMPANY_ADMIN"] as const)("%s sees everyone, with names and no coordinates", async (role) => {
      const { company, alex, sam } = await setUp();
      const caller = await addPerson(company, role, { profile: false });
      const office = await addSite(company, { type: "OFFICE", name: "Head Office" });
      await addRecord(company, alex, { checkInLat: 6.9271, checkInLng: 79.8612, checkInSiteId: office.id, checkInDistanceM: 12, checkInWithinRadius: true });
      await addRecord(company, sam);

      const res = await get(await at(caller), "/attendance?date=2026-11-03");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      const row = res.body.data.find((r: { employeeId: string }) => r.employeeId === alex.employeeId);
      expect(AttendanceListRowSchema.parse(row)).toMatchObject({ employeeName: "Test User", siteName: "Head Office", checkInDistanceM: 12, checkInWithinRadius: true });
      for (const field of COORDINATE_FIELDS) expect(res.body.data[0]).not.toHaveProperty(field);
      expect(JSON.stringify(res.body)).not.toContain("79.86");
    });

    it("filters by day, range, employee, department, status and flag", async () => {
      const { company, hr, alex, sam } = await setUp();
      const department = await platformPrisma.department.create({ data: { companyId: company.id, name: "Field" } });
      await platformPrisma.employee.update({ where: { id: sam.employeeId }, data: { departmentId: department.id } });
      await addRecord(company, alex, { flags: ["LOW_ACCURACY"] });
      await addRecord(company, alex, { workDate: new Date("2026-11-02"), status: "PRESENT", lateMinutes: 0 });
      await addRecord(company, sam, { status: "PRESENT", lateMinutes: 0 });
      const token = await at(hr);
      const total = async (query: string) => (await get(token, `/attendance?${query}`)).body.total;

      expect(await total("")).toBe(3);
      expect(await total("date=2026-11-03")).toBe(2);
      expect(await total("from=2026-11-01&to=2026-11-02")).toBe(1);
      expect(await total(`employeeId=${alex.employeeId}`)).toBe(2);
      expect(await total(`departmentId=${department.id}`)).toBe(1);
      expect(await total("status=LATE")).toBe(1);
      expect(await total("flag=LOW_ACCURACY")).toBe(1);
      expect(await total("date=2026-11-03&status=PRESENT")).toBe(1);
    });

    it("newest day first, then by name, one page at a time", async () => {
      const { company, hr, alex, sam } = await setUp();
      await platformPrisma.employee.update({ where: { id: alex.employeeId }, data: { firstName: "Zoe" } });
      await platformPrisma.employee.update({ where: { id: sam.employeeId }, data: { firstName: "Amal" } });
      await addRecord(company, alex);
      await addRecord(company, sam);
      await addRecord(company, sam, { workDate: new Date("2026-11-02") });
      const token = await at(hr);

      const first = await get(token, "/attendance?pageSize=2");
      const second = await get(token, "/attendance?pageSize=2&page=2");

      expect(first.body.data.map((r: { employeeName: string }) => r.employeeName)).toEqual(["Amal User", "Zoe User"]);
      expect(first.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
      expect(second.body.data[0].workDate).toBe("2026-11-02");
    });

    it.each([
      ["a day and a range", "date=2026-11-03&from=2026-11-01"],
      ["a range over 93 days", "from=2026-01-01&to=2026-12-31"],
      ["a backwards range", "from=2026-11-03&to=2026-11-01"],
      ["a malformed date", "date=yesterday"],
      ["an unknown status", "status=HERE"],
      ["an oversized page", "pageSize=101"],
    ])("refuses %s", async (_name, query) => {
      const { hr } = await setUp();
      expect((await get(await at(hr), `/attendance?${query}`)).status).toBe(400);
    });

    it("never shows another company's rows", async () => {
      const { hr } = await setUp();
      const other = await setUp();
      await addRecord(other.company, other.alex);

      const res = await get(await at(hr), `/attendance?employeeId=${other.alex.employeeId}`);

      expect(res.body).toMatchObject({ data: [], total: 0 });
    });

    describe("an ABSENT row with a visit that day", () => {
      it("carries ON_ABSENT_DAY so HR can spot it", async () => {
        const { company, hr, alex } = await setUp();
        const row = await systemRow(company, alex, "ABSENT");
        await addVisit(company, alex, { attendanceRecordId: row.id, flags: ["ON_ABSENT_DAY"] });

        const res = await get(await at(hr), "/attendance?status=ABSENT");

        expect(res.body.data[0]).toMatchObject({ status: "ABSENT", siteVisitFlags: ["ON_ABSENT_DAY"] });
      });

      it("a plain ABSENT row has none", async () => {
        const { company, hr, alex } = await setUp();
        await systemRow(company, alex, "ABSENT");

        const res = await get(await at(hr), "/attendance");

        expect(res.body.data[0].siteVisitFlags).toEqual([]);
      });

      it("disappears once HR corrects the row, while the visit keeps its flag", async () => {
        const { company, hr, alex } = await setUp();
        const row = await systemRow(company, alex, "ABSENT");
        const visit = await addVisit(company, alex, { attendanceRecordId: row.id, flags: ["ON_ABSENT_DAY"] });
        const token = await at(hr);

        const corrected = await patch(token, row.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });
        expect(corrected.status).toBe(200);

        const res = await get(token, "/attendance");
        expect(res.body.data[0]).toMatchObject({ status: "PRESENT", siteVisitFlags: [] });
        expect((await platformPrisma.siteVisit.findUniqueOrThrow({ where: { id: visit.id } })).flags).toEqual(["ON_ABSENT_DAY"]);
      });

      it("isn't shown with sites off, where HR can't see the visit", async () => {
        const { company, hr, alex } = await setUp({ attendance: true });
        const row = await systemRow(company, alex, "ABSENT");
        await addVisit(company, alex, { attendanceRecordId: row.id, flags: ["ON_ABSENT_DAY"] });

        const res = await get(await at(hr), "/attendance");

        expect(res.body.data[0].siteVisitFlags).toEqual([]);
      });
    });
  });

  describe("GET /attendance/team", () => {
    it("my direct reports only, with no coordinates", async () => {
      const { company, manager, alex, sam } = await setUp();
      await addRecord(company, alex, { checkInLat: 6.9271, checkInLng: 79.8612, checkInDistanceM: 18 });
      await addRecord(company, sam);

      const res = await get(await at(manager), "/attendance/team?date=2026-11-03");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0]).toMatchObject({ employeeId: alex.employeeId, checkInDistanceM: 18 });
      expect(JSON.stringify(res.body)).not.toContain("79.86");
      for (const field of COORDINATE_FIELDS) expect(res.body.data[0]).not.toHaveProperty(field);
    });

    it("an employee outside the team just finds nothing", async () => {
      const { company, manager, sam } = await setUp();
      await addRecord(company, sam);

      const res = await get(await at(manager), `/attendance/team?employeeId=${sam.employeeId}`);

      expect(res.body).toMatchObject({ data: [], total: 0 });
    });

    it("doesn't include the manager's own record", async () => {
      const { company, manager } = await setUp();
      await addRecord(company, manager);

      expect((await get(await at(manager), "/attendance/team")).body.total).toBe(0);
    });

    it("another company's direct report can't be reached", async () => {
      const { manager } = await setUp();
      const other = await setUp();
      await addRecord(other.company, other.alex);

      const res = await get(await at(manager), `/attendance/team?employeeId=${other.alex.employeeId}`);

      expect(res.body.total).toBe(0);
    });
  });

  describe("GET /attendance/:id", () => {
    it("HR gets the name, the office, positions and the history, newest first", async () => {
      const { company, hr, alex } = await setUp();
      const office = await addSite(company, { type: "OFFICE", name: "Head Office" });
      const record = await addRecord(company, alex, { checkInLat: 6.9271, checkInLng: 79.8612, checkInSiteId: office.id });
      const token = await at(hr);
      await patch(token, record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });
      vi.setSystemTime(new Date(NOW.getTime() + 1000));
      await patch(token, record.id, { checkOutAt: iso("03", "17:00:00"), reason: "Left without tapping" });

      const res = await get(token, `/attendance/${record.id}`);

      expect(res.status).toBe(200);
      const detail = AttendanceRecordDetailSchema.parse(res.body);
      expect(detail.employee.name).toBe("Test User");
      expect(detail.siteName).toBe("Head Office");
      expect(res.body.record.checkInLat).toBe(6.9271);
      expect(detail.corrections).toHaveLength(2);
      expect(new Set(detail.corrections.map((c) => c.reason))).toEqual(new Set([REASON, "Left without tapping"]));
      const first = detail.corrections.find((c) => c.reason === REASON)!;
      expect(first.correctedByName).toBe("Test User");
      expect(first.before).toEqual({ checkInAt: iso("03", "09:30:00"), status: "LATE" });
      expect(first.after).toEqual({ checkInAt: iso("03", "08:55:00"), status: "PRESENT" });
    });

    it("a corrector with no employee profile has no name to show", async () => {
      const { company, alex } = await setUp();
      const admin = await addPerson(company, "COMPANY_ADMIN", { profile: false });
      const record = await addRecord(company, alex);
      const token = await at(admin);
      await patch(token, record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });

      const res = await get(token, `/attendance/${record.id}`);

      expect(res.body.corrections[0].correctedByName).toBeNull();
    });

    it("their manager sees the history and no positions", async () => {
      const { company, hr, manager, alex } = await setUp();
      const record = await addRecord(company, alex, { checkInLat: 6.9271, checkInLng: 79.8612 });
      await patch(await at(hr), record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });

      const res = await get(await at(manager), `/attendance/${record.id}`);

      expect(res.status).toBe(200);
      expect(res.body.corrections).toHaveLength(1);
      for (const field of COORDINATE_FIELDS) expect(res.body.record).not.toHaveProperty(field);
      expect(JSON.stringify(res.body)).not.toContain("79.86");
    });

    it("the employee sees their own history", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex);
      await patch(await at(hr), record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });

      const res = await get(await at(alex), `/attendance/${record.id}`);

      expect(res.body.corrections[0].reason).toBe(REASON);
    });

    it("another company's record is a 404", async () => {
      const { hr } = await setUp();
      const other = await setUp();
      const record = await addRecord(other.company, other.alex);

      expect((await get(await at(hr), `/attendance/${record.id}`)).status).toBe(404);
    });
  });

  describe("PATCH /attendance/:id/correct", () => {
    it("the plan's example: LATE becomes PRESENT, with history, audit and a notification", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex);

      const res = await patch(await at(hr), record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });

      expect(res.status).toBe(200);
      expect(res.body.record).toMatchObject({ status: "PRESENT", lateMinutes: 0, isCorrected: true, checkInAt: iso("03", "08:55:00") });

      const [correction] = await correctionsOf(record.id);
      expect(correction).toMatchObject({ reason: REASON, correctedByUserId: hr.userId, siteVisitId: null });

      const [audit] = await auditsOf(company, "ATTENDANCE_CORRECTED");
      expect(audit).toMatchObject({ actorUserId: hr.userId, entityType: "AttendanceRecord", entityId: record.id });
      expect(audit!.metadata).toMatchObject({ reason: REASON, before: { status: "LATE" }, after: { status: "PRESENT" } });

      const [notice] = await noticesOf(alex);
      expect(notice).toMatchObject({ type: "ATTENDANCE_CORRECTED", relatedEntityType: "AttendanceRecord", relatedEntityId: record.id });
      expect(notice!.body).toContain("03 Nov 2026");
      expect(notice!.body).toContain(REASON);
    });

    it("COMPANY_ADMIN can correct too", async () => {
      const { company, alex } = await setUp();
      const admin = await addPerson(company, "COMPANY_ADMIN", { profile: false });
      const record = await addRecord(company, alex);

      expect((await patch(await at(admin), record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON })).status).toBe(200);
    });

    it("a check-in later than the grace period makes the day LATE", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex, { status: "PRESENT", lateMinutes: 0, checkInAt: colombo("03", "09:00:00") });

      const res = await patch(await at(hr), record.id, { checkInAt: iso("03", "09:45:00"), reason: REASON });

      expect(res.body.record).toMatchObject({ status: "LATE", lateMinutes: 45 });
    });

    it("adding a check-out works out the worked and early minutes", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex);

      const res = await patch(await at(hr), record.id, { checkOutAt: iso("03", "16:30:00"), reason: REASON });

      expect(res.body.record).toMatchObject({ checkOutAt: iso("03", "16:30:00"), workedMinutes: 420, earlyLeaveMinutes: 30, status: "LATE" });
    });

    it("the record's own schedule snapshot is what it's judged against", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex);
      await platformPrisma.employeeSchedule.create({ data: { companyId: company.id, employeeId: alex.employeeId, startTime: "06:00", endTime: "14:00" } });

      const res = await patch(await at(hr), record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });

      expect(res.body.record).toMatchObject({ status: "PRESENT", scheduledStartAt: iso("03", "09:00:00") });
    });

    it("the GPS columns stay as captured", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex, { checkInLat: 6.9271, checkInLng: 79.8612, checkInDistanceM: 850, checkInWithinRadius: false, flags: ["LOW_ACCURACY"] });

      const res = await patch(await at(hr), record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });

      expect(res.body.record).toMatchObject({ checkInLat: 6.9271, checkInLng: 79.8612, checkInDistanceM: 850, checkInWithinRadius: false, flags: ["LOW_ACCURACY"] });
    });

    it("no coordinates reach the history or the audit log", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex, { checkInLat: 6.9271, checkInLng: 79.8612 });

      await patch(await at(hr), record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });

      const [correction] = await correctionsOf(record.id);
      const [audit] = await auditsOf(company, "ATTENDANCE_CORRECTED");
      expect(JSON.stringify([correction!.before, correction!.after, audit!.metadata])).not.toMatch(/79\.86|Lat|Lng/);
    });

    it("an auto-closed day stays INCOMPLETE until it has a check-out", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex, { status: "INCOMPLETE", autoClosedAt: colombo("03", "21:00:00"), flags: ["AUTO_CLOSED"] });
      const token = await at(hr, colombo("04", "10:00:00"));

      const inOnly = await patch(token, record.id, { checkInAt: iso("03", "09:05:00"), reason: REASON });
      expect(inOnly.body.record.status).toBe("INCOMPLETE");

      const res = await patch(token, record.id, { checkOutAt: iso("03", "17:00:00"), reason: REASON });
      expect(res.body.record).toMatchObject({ status: "PRESENT", workedMinutes: 475, flags: ["AUTO_CLOSED"] });
    });

    it("earns LONG_SHIFT over 16 hours", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex);

      const res = await patch(await at(hr, LATER_DAY), record.id, { checkOutAt: iso("04", "02:00:00"), reason: REASON });

      expect(res.body.record.flags).toContain("LONG_SHIFT");
    });

    describe("a row with no check-in", () => {
      it.each([
        ["ABSENT", "2026-11-03"],
        ["ON_LEAVE", "2026-11-03"],
      ] as const)("%s can be given times, becoming PRESENT or LATE", async (status, workDate) => {
        const { company, hr, alex } = await setUp();
        const row = await systemRow(company, alex, status, workDate);

        const res = await patch(await at(hr), row.id, { checkInAt: iso("03", "09:30:00"), checkOutAt: iso("03", "17:00:00"), reason: REASON });

        expect(res.status).toBe(200);
        expect(res.body.record).toMatchObject({ status: "LATE", lateMinutes: 30, workedMinutes: 450, source: "HR", scheduledStartAt: iso("03", "09:00:00") });
      });

      it("a HOLIDAY row earns the same flag a check-in that day would", async () => {
        const { company, hr, alex } = await setUp();
        await platformPrisma.companyHoliday.create({ data: { companyId: company.id, date: new Date("2026-11-03"), name: "Poya" } });
        const row = await systemRow(company, alex, "HOLIDAY");

        const res = await patch(await at(hr), row.id, { checkInAt: iso("03", "12:00:00"), reason: REASON });

        expect(res.body.record).toMatchObject({ status: "PRESENT", lateMinutes: 0, flags: ["NON_WORKING_DAY"], scheduledStartAt: null });
      });

      it("a day of approved leave earns ON_APPROVED_LEAVE", async () => {
        const { company, hr, alex } = await setUp();
        const leaveType = await platformPrisma.leaveType.findFirstOrThrow({ where: { companyId: company.id } });
        await platformPrisma.leaveRequest.create({
          data: { companyId: company.id, employeeId: alex.employeeId, leaveTypeId: leaveType.id, startDate: new Date("2026-11-03"), endDate: new Date("2026-11-03"), totalDays: 1, status: "APPROVED" },
        });
        const row = await systemRow(company, alex, "ON_LEAVE");

        const res = await patch(await at(hr), row.id, { checkInAt: iso("03", "09:00:00"), reason: REASON });

        expect(res.body.record.flags).toEqual(["ON_APPROVED_LEAVE"]);
      });

      it("a check-out alone can't be given: it needs a check-in", async () => {
        const { company, hr, alex } = await setUp();
        const row = await systemRow(company, alex, "ABSENT");

        const res = await patch(await at(hr), row.id, { checkOutAt: iso("03", "17:00:00"), reason: REASON });

        expect(res.status).toBe(400);
        expect(res.body.error.details.fieldErrors.checkInAt).toBeTruthy();
        expect(await rowOf(row.id)).toMatchObject({ status: "ABSENT", isCorrected: false });
      });
    });

    describe("HR can't do it to themselves", () => {
      it.each(["HR", "COMPANY_ADMIN"] as const)("%s correcting their own record is refused", async (role) => {
        const company = await setUpCompany();
        const person = await addPerson(company, role);
        const record = await addRecord(company, person);

        const res = await patch(await at(person), record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("CANNOT_CORRECT_OWN_ATTENDANCE");
        expect(await rowOf(record.id)).toMatchObject({ status: "LATE", isCorrected: false });
        expect(await correctionsOf(record.id)).toHaveLength(0);
      });

      it("a colleague in HR can correct it", async () => {
        const { company, hr } = await setUp();
        const colleague = await addPerson(company, "HR");
        const record = await addRecord(company, hr);

        expect((await patch(await at(colleague), record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON })).status).toBe(200);
      });
    });

    describe("refuses", () => {
      it.each([
        ["no reason", { checkInAt: iso("03", "08:55:00") }, "reason"],
        ["a reason under 5 characters", { checkInAt: iso("03", "08:55:00"), reason: "oops" }, "reason"],
        ["a check-in in the future", { checkInAt: iso("03", "18:30:00"), reason: REASON }, "checkInAt"],
        ["a check-out in the future", { checkOutAt: iso("03", "18:30:00"), reason: REASON }, "checkOutAt"],
        ["a check-in on another day", { checkInAt: iso("02", "09:00:00"), reason: REASON }, "checkInAt"],
        ["a check-out before the stored check-in", { checkOutAt: iso("03", "09:00:00"), reason: REASON }, "checkOutAt"],
        ["a check-out and check-in out of order", { checkInAt: iso("03", "12:00:00"), checkOutAt: iso("03", "11:00:00"), reason: REASON }, "checkOutAt"],
      ])("%s, on that field", async (_name, body, field) => {
        const { company, hr, alex } = await setUp();
        const record = await addRecord(company, alex);

        const res = await patch(await at(hr), record.id, body);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
        expect(res.body.error.details.fieldErrors[field]).toBeTruthy();
        expect(await rowOf(record.id)).toMatchObject({ isCorrected: false, status: "LATE" });
        expect(await correctionsOf(record.id)).toHaveLength(0);
        expect(await noticesOf(alex)).toHaveLength(0);
      });

      it("a check-out more than 24 hours after check-in, as a mistyped date", async () => {
        const { company, hr, alex } = await setUp();
        const record = await addRecord(company, alex);

        const res = await patch(await at(hr, LATER_DAY), record.id, { checkOutAt: iso("04", "17:00:00"), reason: REASON });

        expect(res.status).toBe(400);
        expect(res.body.error.details.fieldErrors.checkOutAt).toBeTruthy();
      });

      it("a body with no change at all", async () => {
        const { company, hr, alex } = await setUp();
        const record = await addRecord(company, alex);

        expect((await patch(await at(hr), record.id, { reason: REASON })).status).toBe(400);
      });

      it("the values it already has: no history, no mark and no notification", async () => {
        const { company, hr, alex } = await setUp();
        const record = await addRecord(company, alex);

        const res = await patch(await at(hr), record.id, { checkInAt: iso("03", "09:30:00"), reason: REASON });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("NOTHING_TO_CORRECT");
        expect(await rowOf(record.id)).toMatchObject({ isCorrected: false });
        expect(await correctionsOf(record.id)).toHaveLength(0);
        expect(await noticesOf(alex)).toHaveLength(0);
        expect(await auditsOf(company, "ATTENDANCE_CORRECTED")).toHaveLength(0);
      });
    });

    it("a status in the body is ignored: it follows from the times", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex);

      const res = await patch(await at(hr), record.id, { checkOutAt: iso("03", "17:00:00"), status: "PRESENT", reason: REASON });

      expect(res.body.record.status).toBe("LATE");
    });

    describe("a night shift", () => {
      it("its check-in can fall after midnight", async () => {
        const { company, hr, alex } = await setUp();
        const record = await addRecord(company, alex, {
          scheduledStartAt: colombo("03", "22:00:00"),
          scheduledEndAt: colombo("04", "06:00:00"),
          checkInAt: colombo("03", "22:30:00"),
          status: "LATE",
          lateMinutes: 30,
        });

        const res = await patch(await at(hr, LATER_DAY), record.id, { checkInAt: iso("04", "00:20:00"), reason: REASON });

        expect(res.status).toBe(200);
        expect(res.body.record).toMatchObject({ workDate: "2026-11-03", status: "LATE", lateMinutes: 140 });
      });

      it("a day shift's can't", async () => {
        const { company, hr, alex } = await setUp();
        const record = await addRecord(company, alex);

        const res = await patch(await at(hr, LATER_DAY), record.id, { checkInAt: iso("04", "00:20:00"), reason: REASON });

        expect(res.status).toBe(400);
      });
    });

    describe("the office", () => {
      it("can be set, and shows in the history by name", async () => {
        const { company, hr, alex } = await setUp();
        const office = await addSite(company, { type: "OFFICE", name: "Galle Office" });
        const record = await addRecord(company, alex);

        const res = await patch(await at(hr), record.id, { siteId: office.id, reason: "Was at Galle that day" });

        expect(res.body.record.checkInSiteId).toBe(office.id);
        expect((await correctionsOf(record.id))[0]!.after).toEqual({ siteName: "Galle Office" });
      });

      it("can be cleared", async () => {
        const { company, hr, alex } = await setUp();
        const office = await addSite(company, { type: "OFFICE" });
        const record = await addRecord(company, alex, { checkInSiteId: office.id });

        const res = await patch(await at(hr), record.id, { siteId: null, reason: "Wasn't at an office" });

        expect(res.body.record.checkInSiteId).toBeNull();
      });

      it("an inactive office is allowed: a past day may well have been there", async () => {
        const { company, hr, alex } = await setUp();
        const office = await addSite(company, { type: "OFFICE", isActive: false });
        const record = await addRecord(company, alex);

        expect((await patch(await at(hr), record.id, { siteId: office.id, reason: REASON })).status).toBe(200);
      });

      it("an external site is a 404", async () => {
        const { company, hr, alex } = await setUp();
        const site = await addSite(company);
        const record = await addRecord(company, alex);

        expect((await patch(await at(hr), record.id, { siteId: site.id, reason: REASON })).status).toBe(404);
      });

      it("another company's office is a 404", async () => {
        const { company, hr, alex } = await setUp();
        const other = await setUp();
        const office = await addSite(other.company, { type: "OFFICE" });
        const record = await addRecord(company, alex);

        expect((await patch(await at(hr), record.id, { siteId: office.id, reason: REASON })).status).toBe(404);
      });

      it("with sites off, naming one answers MODULE_DISABLED", async () => {
        const { company, hr, alex } = await setUp({ attendance: true });
        const office = await addSite(company, { type: "OFFICE" });
        const record = await addRecord(company, alex);

        const res = await patch(await at(hr), record.id, { siteId: office.id, reason: REASON });

        expect(res.status).toBe(403);
        expect(res.body.error).toMatchObject({ code: "MODULE_DISABLED", details: { module: "sites" } });
      });
    });

    it("another company's record is a 404, and nothing changes", async () => {
      const { hr } = await setUp();
      const other = await setUp();
      const record = await addRecord(other.company, other.alex);

      const res = await patch(await at(hr), record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });

      expect(res.status).toBe(404);
      expect(await rowOf(record.id)).toMatchObject({ status: "LATE", isCorrected: false });
    });

    it("an employee with no active login still gets corrected, with nobody to notify", async () => {
      const { company, hr, alex } = await setUp();
      await platformPrisma.user.update({ where: { id: alex.userId }, data: { status: "DEACTIVATED" } });
      const record = await addRecord(company, alex);

      const res = await patch(await at(hr), record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });

      expect(res.status).toBe(200);
      expect(await noticesOf(alex)).toHaveLength(0);
    });

    it("an employee who checks out a moment later keeps both", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex);
      await patch(await at(hr), record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON });

      const res = await request(app).post("/api/v1/attendance/check-out").set("Authorization", await at(alex)).send({});

      expect(res.status).toBe(200);
      expect(res.body.record).toMatchObject({ status: "PRESENT", checkInAt: iso("03", "08:55:00"), isCorrected: true, workedMinutes: 545 });
    });

    it("two corrections at the same moment: never two histories from one row version", async () => {
      const { company, hr, alex } = await setUp();
      const colleague = await addPerson(company, "HR");
      const record = await addRecord(company, alex);
      const [tokenA, tokenB] = [await at(hr), await at(colleague)];

      const results = await Promise.all([
        patch(tokenA, record.id, { checkInAt: iso("03", "08:55:00"), reason: REASON }),
        patch(tokenB, record.id, { checkInAt: iso("03", "08:50:00"), reason: REASON }),
      ]);

      const history = await correctionsOf(record.id);
      const succeeded = results.filter((res) => res.status === 200);
      expect(succeeded.length).toBeGreaterThanOrEqual(1);
      expect(history).toHaveLength(succeeded.length);
      for (const res of results) expect([200, 409]).toContain(res.status);
      if (results.some((res) => res.status === 409)) {
        expect(results.find((res) => res.status === 409)!.body.error.code).toBe("RECORD_CHANGED");
      }
    });
  });

  // The company's time decides which day a time is on, not the server's.
  describe.each(TEST_TIMEZONES)("the work date check with server TZ=$tz", ({ tz, offsetMinutes }) => {
    useProcessTimezone(tz, offsetMinutes);

    it("00:10 in Colombo is the 3rd there, whatever the UTC date", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex);

      const res = await patch(await at(hr), record.id, { checkInAt: iso("03", "00:10:00"), reason: REASON });

      expect(res.status).toBe(200);
    });

    it("23:50 on the 2nd in Colombo isn't the 3rd", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex);

      const res = await patch(await at(hr), record.id, { checkInAt: iso("02", "23:50:00"), reason: REASON });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /attendance", () => {
    const body = (person: Person, extra: object = {}) => ({
      employeeId: person.employeeId,
      workDate: "2026-11-02",
      checkInAt: iso("02", "09:05:00"),
      checkOutAt: iso("02", "17:00:00"),
      reason: "Phone was broken",
      ...extra,
    });

    it("creates the missing day, judged normally, with history, audit and a notification", async () => {
      const { company, hr, alex } = await setUp();

      const res = await post(await at(hr), body(alex));

      expect(res.status).toBe(201);
      expect(res.body.record).toMatchObject({
        workDate: "2026-11-02",
        status: "PRESENT",
        source: "HR",
        isCorrected: true,
        workedMinutes: 475,
        scheduledStartAt: iso("02", "09:00:00"),
        checkInLat: null,
        checkInDistanceM: null,
      });

      const [correction] = await correctionsOf(res.body.record.id);
      expect(correction).toMatchObject({ before: null, reason: "Phone was broken", correctedByUserId: hr.userId });
      expect(correction!.after).toMatchObject({ status: "PRESENT", checkInAt: iso("02", "09:05:00") });

      const [audit] = await auditsOf(company, "ATTENDANCE_CREATED_BY_HR");
      expect(audit).toMatchObject({ entityId: res.body.record.id, actorUserId: hr.userId });

      const [notice] = await noticesOf(alex);
      expect(notice).toMatchObject({ type: "ATTENDANCE_CORRECTED", relatedEntityId: res.body.record.id });
    });

    it.each(["COMPANY_ADMIN"] as const)("%s with no employee profile can too", async (role) => {
      const { company, alex } = await setUp();
      const admin = await addPerson(company, role, { profile: false });

      expect((await post(await at(admin), body(alex))).status).toBe(201);
    });

    it("a late one is LATE", async () => {
      const { hr, alex } = await setUp();

      const res = await post(await at(hr), body(alex, { checkInAt: iso("02", "09:45:00") }));

      expect(res.body.record).toMatchObject({ status: "LATE", lateMinutes: 45 });
    });

    it("the check-out is optional, and the employee can still check out today", async () => {
      const { hr, alex } = await setUp();

      const res = await post(await at(hr, colombo("03", "11:00:00")), { employeeId: alex.employeeId, workDate: "2026-11-03", checkInAt: iso("03", "09:00:00"), reason: REASON });

      expect(res.body.record).toMatchObject({ checkOutAt: null, workedMinutes: null });
      const out = await request(app).post("/api/v1/attendance/check-out").set("Authorization", await at(alex, colombo("03", "17:00:00"))).send({});
      expect(out.body.record).toMatchObject({ id: res.body.record.id, workedMinutes: 480 });
    });

    it("uses the employee's override", async () => {
      const { company, hr, alex } = await setUp();
      await platformPrisma.employeeSchedule.create({ data: { companyId: company.id, employeeId: alex.employeeId, startTime: "11:00", endTime: "19:00" } });

      const res = await post(await at(hr), body(alex, { checkInAt: iso("02", "10:30:00"), checkOutAt: iso("02", "17:00:00") }));

      expect(res.body.record).toMatchObject({ status: "PRESENT", scheduledStartAt: iso("02", "11:00:00") });
    });

    it("a Sunday has no schedule: never late, and flagged", async () => {
      const { hr, alex } = await setUp();

      const res = await post(await at(hr, colombo("09", "12:00:00")), {
        employeeId: alex.employeeId,
        workDate: "2026-11-08",
        checkInAt: iso("08", "15:00:00"),
        reason: REASON,
      });

      expect(res.body.record).toMatchObject({ status: "PRESENT", flags: ["NON_WORKING_DAY"], scheduledStartAt: null });
    });

    it("links a visit past the close time that had no row, and keeps its flag", async () => {
      const { company, hr, alex } = await setUp();
      const visit = await addVisit(company, alex, { workDate: new Date("2026-11-02"), checkInAt: colombo("02", "22:00:00"), checkOutAt: colombo("02", "23:00:00"), flags: ["AFTER_HOURS"] });
      const token = await at(hr);

      const res = await post(token, body(alex));

      const row = await platformPrisma.siteVisit.findUniqueOrThrow({ where: { id: visit.id } });
      expect(row).toMatchObject({ attendanceRecordId: res.body.record.id, flags: ["AFTER_HOURS"] });
      const detail = await get(token, `/attendance/${res.body.record.id}`);
      expect(detail.body.siteVisits).toHaveLength(1);
    });

    it("doesn't link another employee's visit, or another day's", async () => {
      const { company, hr, alex, sam } = await setUp();
      const samsVisit = await addVisit(company, sam, { workDate: new Date("2026-11-02"), checkInAt: colombo("02", "10:00:00"), checkOutAt: colombo("02", "11:00:00") });
      const otherDay = await addVisit(company, alex, { workDate: new Date("2026-11-01"), checkInAt: colombo("01", "10:00:00"), checkOutAt: colombo("01", "11:00:00") });

      await post(await at(hr), body(alex));

      expect((await platformPrisma.siteVisit.findUniqueOrThrow({ where: { id: samsVisit.id } })).attendanceRecordId).toBeNull();
      expect((await platformPrisma.siteVisit.findUniqueOrThrow({ where: { id: otherDay.id } })).attendanceRecordId).toBeNull();
    });

    describe("refuses", () => {
      it("a day that already has a row, naming it", async () => {
        const { company, hr, alex } = await setUp();
        const existing = await addRecord(company, alex, { workDate: new Date("2026-11-02") });

        const res = await post(await at(hr), body(alex));

        expect(res.status).toBe(409);
        expect(res.body.error).toMatchObject({ code: "ATTENDANCE_RECORD_EXISTS", details: { recordId: existing.id } });
      });

      it("a row with no check-in counts too: it's corrected, not created", async () => {
        const { company, hr, alex } = await setUp();
        await systemRow(company, alex, "ABSENT", "2026-11-02");

        expect((await post(await at(hr), body(alex))).status).toBe(409);
      });

      it.each(["HR", "COMPANY_ADMIN"] as const)("%s creating their own", async (role) => {
        const company = await setUpCompany();
        const person = await addPerson(company, role);

        const res = await post(await at(person), body(person));

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("CANNOT_CORRECT_OWN_ATTENDANCE");
        expect(await platformPrisma.attendanceRecord.count({ where: { employeeId: person.employeeId } })).toBe(0);
      });

      it("another company's employee, as a 404", async () => {
        const { hr } = await setUp();
        const other = await setUp();

        const res = await post(await at(hr), body(other.alex));

        expect(res.status).toBe(404);
        expect(await platformPrisma.attendanceRecord.count({ where: { employeeId: other.alex.employeeId } })).toBe(0);
      });

      it("another company's office, as a 404", async () => {
        const { hr, alex } = await setUp();
        const other = await setUp();
        const office = await addSite(other.company, { type: "OFFICE" });

        expect((await post(await at(hr), body(alex, { siteId: office.id }))).status).toBe(404);
      });

      it("a day before they joined", async () => {
        const { hr, alex } = await setUp();
        await platformPrisma.employee.update({ where: { id: alex.employeeId }, data: { joiningDate: new Date("2026-11-03") } });

        const res = await post(await at(hr), body(alex));

        expect(res.status).toBe(400);
        expect(res.body.error.details.fieldErrors.workDate).toBeTruthy();
      });

      it("the future", async () => {
        const { hr, alex } = await setUp();

        const res = await post(await at(hr), { employeeId: alex.employeeId, workDate: "2026-11-04", checkInAt: iso("04", "09:00:00"), reason: REASON });

        expect(res.status).toBe(400);
        expect(res.body.error.details.fieldErrors.checkInAt).toBeTruthy();
      });

      it("a check-in on another day than the work date", async () => {
        const { hr, alex } = await setUp();

        const res = await post(await at(hr), body(alex, { checkInAt: iso("01", "09:00:00"), checkOutAt: iso("01", "17:00:00") }));

        expect(res.status).toBe(400);
      });

      it("no reason", async () => {
        const { hr, alex } = await setUp();

        const res = await post(await at(hr), body(alex, { reason: "" }));

        expect(res.status).toBe(400);
      });
    });

    it("a company id in the body is ignored", async () => {
      const { company, hr, alex } = await setUp();
      const other = await setUp();

      const res = await post(await at(hr), body(alex, { companyId: other.company.id }));

      expect(res.status).toBe(201);
      expect((await rowOf(res.body.record.id)).companyId).toBe(company.id);
    });

    it("two creates at the same moment: one row, and the other is told", async () => {
      const { company, hr, alex } = await setUp();
      const colleague = await addPerson(company, "HR");
      const [tokenA, tokenB] = [await at(hr), await at(colleague)];

      const results = await Promise.all([post(tokenA, body(alex)), post(tokenB, body(alex))]);

      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(await platformPrisma.attendanceRecord.count({ where: { employeeId: alex.employeeId } })).toBe(1);
      expect(await noticesOf(alex)).toHaveLength(1);
      expect(await platformPrisma.attendanceCorrection.count({ where: { companyId: company.id } })).toBe(1);
    });
  });

  describe("PATCH /site-visits/:id/correct", () => {
    it("changes the times and duration, with history, audit and a notification", async () => {
      const { company, hr, alex } = await setUp();
      const visit = await addVisit(company, alex);

      const res = await patchVisit(await at(hr), visit.id, { checkOutAt: iso("03", "12:30:00"), reason: "Left without tapping" });

      expect(res.status).toBe(200);
      expect(res.body.visit).toMatchObject({ durationMinutes: 150, isCorrected: true, status: "CLOSED" });

      const [correction] = await platformPrisma.attendanceCorrection.findMany({ where: { siteVisitId: visit.id } });
      expect(correction).toMatchObject({ attendanceRecordId: null, reason: "Left without tapping", correctedByUserId: hr.userId });
      expect(correction!.before).toEqual({ checkOutAt: iso("03", "11:00:00") });

      const [audit] = await auditsOf(company, "SITE_VISIT_CORRECTED");
      expect(audit).toMatchObject({ entityType: "SiteVisit", entityId: visit.id });

      const [notice] = await noticesOf(alex);
      expect(notice).toMatchObject({ type: "ATTENDANCE_CORRECTED", relatedEntityType: "SiteVisit", relatedEntityId: visit.id });
      expect(notice!.body).toContain(visit.site.name);
      expect(notice!.body).toContain("Left without tapping");
    });

    it("a check-out closes an open visit, so the employee can start another", async () => {
      const { company, hr, alex } = await setUp();
      const visit = await addVisit(company, alex, { status: "OPEN", checkOutAt: null, durationMinutes: null });

      const res = await patchVisit(await at(hr), visit.id, { checkOutAt: iso("03", "11:00:00"), reason: "Forgot to check out" });

      expect(res.body.visit).toMatchObject({ status: "CLOSED", durationMinutes: 60 });
      expect((await get(await at(alex), "/site-visits/me/open")).body.visit).toBeNull();
    });

    it("an open visit's check-in can be moved, and it stays open", async () => {
      const { company, hr, alex } = await setUp();
      const visit = await addVisit(company, alex, { status: "OPEN", checkOutAt: null, durationMinutes: null });

      const res = await patchVisit(await at(hr), visit.id, { checkInAt: iso("03", "09:55:00"), reason: REASON });

      expect(res.body.visit).toMatchObject({ status: "OPEN", checkOutAt: null, durationMinutes: null });
    });

    it("an auto-closed visit gets its times", async () => {
      const { company, hr, alex } = await setUp();
      const visit = await addVisit(company, alex, { status: "AUTO_CLOSED", checkOutAt: null, durationMinutes: null });

      const res = await patchVisit(await at(hr), visit.id, { checkOutAt: iso("03", "11:30:00"), reason: "Forgot to check out" });

      expect(res.body.visit).toMatchObject({ status: "CLOSED", durationMinutes: 90 });
    });

    it("leaves the flags, the position and the attendance record alone", async () => {
      const { company, hr, alex } = await setUp();
      const record = await addRecord(company, alex);
      const visit = await addVisit(company, alex, { attendanceRecordId: record.id, flags: ["AFTER_HOURS"], checkInLat: 6.9271, checkInLng: 79.8612 });

      const res = await patchVisit(await at(hr), visit.id, { checkInAt: iso("03", "09:55:00"), reason: REASON });

      expect(res.body.visit).toMatchObject({ flags: ["AFTER_HOURS"], checkInLat: 6.9271, checkInLng: 79.8612 });
      expect(await rowOf(record.id)).toMatchObject({ isCorrected: false, checkInAt: colombo("03", "09:30:00") });
    });

    it("the history shows on the visit, with no positions for the manager", async () => {
      const { company, hr, manager, alex } = await setUp();
      const visit = await addVisit(company, alex, { checkInLat: 6.9271, checkInLng: 79.8612 });
      await patchVisit(await at(hr), visit.id, { checkInAt: iso("03", "09:55:00"), reason: REASON });

      const asHr = await get(await at(hr), `/site-visits/${visit.id}`);
      const asManager = await get(await at(manager), `/site-visits/${visit.id}`);

      expect(SiteVisitDetailSchema.parse(asHr.body).corrections[0]!.reason).toBe(REASON);
      expect(asHr.body.visit.checkInLat).toBe(6.9271);
      expect(asManager.body.corrections[0].reason).toBe(REASON);
      for (const field of COORDINATE_FIELDS) expect(asManager.body.visit).not.toHaveProperty(field);
      expect(JSON.stringify(asManager.body)).not.toContain("79.86");
    });

    it("no coordinates reach the history or the audit log", async () => {
      const { company, hr, alex } = await setUp();
      const visit = await addVisit(company, alex, { checkInLat: 6.9271, checkInLng: 79.8612 });

      await patchVisit(await at(hr), visit.id, { checkInAt: iso("03", "09:55:00"), reason: REASON });

      const [correction] = await platformPrisma.attendanceCorrection.findMany({ where: { siteVisitId: visit.id } });
      const [audit] = await auditsOf(company, "SITE_VISIT_CORRECTED");
      expect(JSON.stringify([correction!.before, correction!.after, audit!.metadata])).not.toMatch(/79\.86|Lat|Lng/);
    });

    it.each(["HR", "COMPANY_ADMIN"] as const)("%s can't correct their own visit", async (role) => {
      const company = await setUpCompany();
      const person = await addPerson(company, role);
      const visit = await addVisit(company, person);

      const res = await patchVisit(await at(person), visit.id, { checkInAt: iso("03", "09:55:00"), reason: REASON });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CANNOT_CORRECT_OWN_ATTENDANCE");
    });

    it("another company's visit is a 404", async () => {
      const { hr } = await setUp();
      const other = await setUp();
      const visit = await addVisit(other.company, other.alex);

      expect((await patchVisit(await at(hr), visit.id, { checkInAt: iso("03", "09:55:00"), reason: REASON })).status).toBe(404);
      expect((await platformPrisma.siteVisit.findUniqueOrThrow({ where: { id: visit.id } })).isCorrected).toBe(false);
    });

    it.each([
      ["the future", { checkOutAt: iso("03", "18:30:00"), reason: REASON }, 400],
      ["a check-out before the stored check-in", { checkOutAt: iso("03", "09:00:00"), reason: REASON }, 400],
      ["another day", { checkInAt: iso("01", "10:00:00"), reason: REASON }, 400],
      ["a short reason", { checkInAt: iso("03", "09:55:00"), reason: "oops" }, 400],
      ["no change", { reason: REASON }, 400],
    ])("refuses %s", async (_name, body, status) => {
      const { company, hr, alex } = await setUp();
      const visit = await addVisit(company, alex);

      expect((await patchVisit(await at(hr), visit.id, body)).status).toBe(status);
      expect((await platformPrisma.siteVisit.findUniqueOrThrow({ where: { id: visit.id } })).isCorrected).toBe(false);
    });

    it("the values it already has", async () => {
      const { company, hr, alex } = await setUp();
      const visit = await addVisit(company, alex);

      const res = await patchVisit(await at(hr), visit.id, { checkInAt: iso("03", "10:00:00"), reason: REASON });

      expect(res.body.error.code).toBe("NOTHING_TO_CORRECT");
      expect(await noticesOf(alex)).toHaveLength(0);
    });

    it("a night worker's visit can start the morning after its work date", async () => {
      const { company, hr, alex } = await setUp();
      const visit = await addVisit(company, alex);

      const res = await patchVisit(await at(hr, LATER_DAY), visit.id, { checkInAt: iso("04", "01:00:00"), checkOutAt: iso("04", "02:00:00"), reason: REASON });

      expect(res.status).toBe(200);
    });

    it("works with attendance off", async () => {
      const { company, hr, alex } = await setUp({ sites: true });
      const visit = await addVisit(company, alex);

      expect((await patchVisit(await at(hr), visit.id, { checkInAt: iso("03", "09:55:00"), reason: REASON })).status).toBe(200);
    });
  });
});
