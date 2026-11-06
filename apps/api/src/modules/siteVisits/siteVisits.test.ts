import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { AttendanceTodaySchema, OpenSiteVisitResponseSchema, SiteVisitSchema, SiteVisitWithCoordinatesSchema } from "@employee-saas/shared";
import { createApp } from "../../app.js";
import { invalidateEnabledModulesCache } from "../../lib/enabledModules.js";
import { platformPrisma } from "../../lib/prisma.js";
import { createTestCompany, createTestUser, DEFAULT_TEST_PASSWORD, platformLoginAs } from "../../test/helpers.js";
import { TEST_TIMEZONES, useProcessTimezone } from "../../test/timezone.js";

const app = createApp();

/** A time on the wall clock in Colombo. 3 Nov 2026 is a Tuesday and the 8th a Sunday.
 * The default schedule is 09:00-17:00, with 10 minutes' grace, and closes at 21:00. */
const colombo = (date: string, time: string) => new Date(`2026-11-${date}T${time}+05:30`);
const MORNING = colombo("03", "10:00:00");

const SITE_AT = { latitude: 6.9271, longitude: 79.8612 };
/** One degree of latitude is about 111.2 km, on the sphere the haversine helper uses. */
const metresNorth = (metres: number) => SITE_AT.latitude + metres / 111_195;

function fix(metres: number, extra: object = {}) {
  return {
    latitude: metresNorth(metres),
    longitude: SITE_AT.longitude,
    accuracy: 10,
    mocked: false,
    capturedAt: new Date().toISOString(),
    ...extra,
  };
}

type Person = { email: string; companyCode: string; employeeId: string; userId: string };
type Company = { id: string; code: string };
const tokens = new Map<string, string>();

/** Moves the clock and returns a logged-in header. Only `Date` is faked, so database
 * calls keep working. Tokens are reused within 10 minutes: login is rate-limited. */
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

async function addSite(company: Company, extra: object = {}) {
  const creator = await platformPrisma.user.findFirst({ where: { companyId: company.id } });
  const owner = creator ?? (await createTestUser({ companyId: company.id, role: "HR", email: `hr-${crypto.randomBytes(3).toString("hex")}@example.test` })).user;
  return platformPrisma.site.create({
    data: {
      companyId: company.id,
      createdByUserId: owner.id,
      name: `Site ${crypto.randomBytes(2).toString("hex")}`,
      type: "EXTERNAL",
      radiusMeters: 200,
      gpsRequired: false,
      ...extra,
    },
  });
}
const gpsSite = (company: Company, extra: object = {}) => addSite(company, { ...SITE_AT, gpsRequired: true, ...extra });

async function setUp(modules?: Record<string, boolean>) {
  const company = await setUpCompany(modules);
  const manager = await addPerson(company, "MANAGER");
  const alex = await addPerson(company, "EMPLOYEE", { managerId: manager.employeeId });
  const site = await addSite(company);
  return { company, manager, alex, site };
}

const newId = () => crypto.randomUUID();

function postCheckIn(token: string, siteId: string, extra: object = {}) {
  return request(app)
    .post("/api/v1/site-visits/check-in")
    .set("Authorization", token)
    .send({ siteId, clientRequestId: newId(), ...extra });
}
function postCheckOut(token: string, visitId: string, body: object = {}) {
  return request(app).post(`/api/v1/site-visits/${visitId}/check-out`).set("Authorization", token).send(body);
}
function postDayCheckIn(token: string) {
  return request(app).post("/api/v1/attendance/check-in").set("Authorization", token).send({ clientRequestId: newId() });
}
function postDayCheckOut(token: string, body: object = {}) {
  return request(app).post("/api/v1/attendance/check-out").set("Authorization", token).send(body);
}
function get(token: string, path: string) {
  return request(app).get(`/api/v1${path}`).set("Authorization", token);
}

const visitsOf = (person: Person) => platformPrisma.siteVisit.findMany({ where: { employeeId: person.employeeId }, orderBy: { checkInAt: "asc" } });
const recordsOf = (person: Person) => platformPrisma.attendanceRecord.findMany({ where: { employeeId: person.employeeId }, orderBy: { workDate: "asc" } });
const notificationsOf = (person: Person) => platformPrisma.notification.findMany({ where: { userId: person.userId } });

async function checkedIn(person: Person, siteId: string, when: Date = MORNING) {
  const res = await postCheckIn(await at(person, when), siteId);
  expect(res.status).toBe(201);
  return res.body.visit as { id: string };
}

/** A row the way the day close job (step 2.7) will write it. */
function systemRow(company: Company, person: Person, workDate: string, status: "ABSENT" | "ON_LEAVE" | "HOLIDAY") {
  return platformPrisma.attendanceRecord.create({
    data: { companyId: company.id, employeeId: person.employeeId, workDate: new Date(workDate), status, source: "SYSTEM" },
  });
}

describe("site visits", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MORNING);
    tokens.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("access", () => {
    const ID = "3f2b8c1e-5d4a-4f6b-9a7c-1e2d3c4b5a69";
    const ENDPOINTS = [
      ["POST", "/site-visits/check-in"],
      ["POST", `/site-visits/${ID}/check-out`],
      ["GET", "/site-visits/me"],
      ["GET", "/site-visits/me/open"],
      ["GET", "/site-visits/team"],
      ["GET", "/site-visits"],
      ["GET", `/site-visits/${ID}`],
    ] as const;

    function call(method: "GET" | "POST", path: string, token?: string) {
      const req = method === "GET" ? request(app).get(`/api/v1${path}`) : request(app).post(`/api/v1${path}`);
      if (token) req.set("Authorization", token);
      return method === "POST" ? req.send({ siteId: ID, clientRequestId: newId() }) : req;
    }

    it.each(ENDPOINTS)("%s %s answers MODULE_DISABLED when sites is off", async (method, path) => {
      const company = await setUpCompany({ attendance: true });
      const hr = await addPerson(company, "HR");

      const res = await call(method, path, await at(hr, MORNING));

      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({ code: "MODULE_DISABLED", details: { module: "sites" } });
    });

    it.each(ENDPOINTS)("%s %s needs a login", async (method, path) => {
      expect((await call(method, path)).status).toBe(401);
    });

    it("every endpoint is closed to SUPER_ADMIN", async () => {
      const email = `root-${crypto.randomBytes(3).toString("hex")}@example.test`;
      const { password } = await createTestUser({ companyId: null, role: "SUPER_ADMIN", email });
      // One login for them all: platform login is rate-limited.
      const login = await platformLoginAs(app, { email, password, clientType: "mobile" });
      const token = `Bearer ${login.body.accessToken as string}`;

      for (const [method, path] of ENDPOINTS) {
        expect((await call(method, path, token)).status, `${method} ${path}`).toBe(403);
      }
    });

    it.each([
      ["POST", "/site-visits/check-in"],
      ["POST", `/site-visits/${ID}/check-out`],
      ["GET", "/site-visits/me"],
      ["GET", "/site-visits/me/open"],
    ] as const)("%s %s answers NO_EMPLOYEE_PROFILE for an admin with no profile", async (method, path) => {
      const company = await setUpCompany();
      const admin = await addPerson(company, "COMPANY_ADMIN", { profile: false });

      const res = await call(method, path, await at(admin, MORNING));

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("NO_EMPLOYEE_PROFILE");
    });

    it.each([
      ["EMPLOYEE", "/site-visits/team"],
      ["HR", "/site-visits/team"],
      ["COMPANY_ADMIN", "/site-visits/team"],
      ["EMPLOYEE", "/site-visits"],
      ["MANAGER", "/site-visits"],
    ] as const)("%s can't call GET %s", async (role, path) => {
      const company = await setUpCompany();
      const person = await addPerson(company, role);

      const res = await get(await at(person, MORNING), path);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("a malformed body or query is a 400", async () => {
      const { alex } = await setUp();
      const token = await at(alex, MORNING);

      expect((await request(app).post("/api/v1/site-visits/check-in").set("Authorization", token).send({})).status).toBe(400);
      expect((await get(token, "/site-visits/me?from=soon")).status).toBe(400);
    });
  });

  describe("the first visit starts the attendance day", () => {
    describe.each(TEST_TIMEZONES)("with server TZ=$tz", ({ tz, offsetMinutes }) => {
      useProcessTimezone(tz, offsetMinutes);

      it.each([
        ["on time", "09:05:00", "PRESENT", 0],
        ["just after grace", "09:10:01", "LATE", 10],
        ["late", "10:42:00", "LATE", 102],
      ])("%s: both rows, with lateness judged normally", async (_label, time, status, lateMinutes) => {
        const { alex, site } = await setUp();
        const when = colombo("03", time);

        const res = await postCheckIn(await at(alex, when), site.id);

        expect(res.status).toBe(201);
        const [record] = await recordsOf(alex);
        const [visit] = await visitsOf(alex);
        expect(record).toMatchObject({ status, lateMinutes, source: "SITE_VISIT", checkInSiteId: null });
        expect(record!.checkInAt).toEqual(when);
        expect(record!.scheduledStartAt).toEqual(colombo("03", "09:00:00"));
        expect(record!.scheduledEndAt).toEqual(colombo("03", "17:00:00"));
        expect(record!.workDate.toISOString().slice(0, 10)).toBe("2026-11-03");
        expect(visit).toMatchObject({ status: "OPEN", siteId: site.id, attendanceRecordId: record!.id, flags: [] });
        expect(visit!.checkInAt).toEqual(when);
        expect(visit!.workDate).toEqual(record!.workDate);
      });
    });

    it("doesn't flag NO_OFFICE_SITE, which is about office check-ins", async () => {
      const { alex, site } = await setUp();

      await checkedIn(alex, site.id);

      expect((await recordsOf(alex))[0]!.flags).toEqual([]);
    });

    it("on a weekly off day: the record is flagged NON_WORKING_DAY, and has no schedule", async () => {
      const { alex, site } = await setUp();

      await checkedIn(alex, site.id, colombo("08", "11:00:00"));

      const [record] = await recordsOf(alex);
      expect(record).toMatchObject({ status: "PRESENT", flags: ["NON_WORKING_DAY"], scheduledStartAt: null });
    });

    it("the Home card then offers a day check-out", async () => {
      const { alex, site } = await setUp();
      const token = await at(alex, MORNING);

      await postCheckIn(token, site.id);

      const res = await get(token, "/attendance/me/today");
      expect(res.body.nextAction).toBe("CHECK_OUT");
      expect(() => AttendanceTodaySchema.parse(res.body)).not.toThrow();
    });

    it("a later visit that same day only adds a visit", async () => {
      const { alex, site, company } = await setUp();
      const first = await checkedIn(alex, site.id);
      const token = await at(alex, new Date(MORNING.getTime() + 60_000));
      await postCheckOut(token, first.id);
      const other = await addSite(company);

      expect((await postCheckIn(token, other.id)).status).toBe(201);

      const [record] = await recordsOf(alex);
      const visits = await visitsOf(alex);
      expect(await recordsOf(alex)).toHaveLength(1);
      expect(visits.map((v) => v.attendanceRecordId)).toEqual([record!.id, record!.id]);
    });

    it("with attendance off: no record, no link, no flags", async () => {
      const { alex, site } = await setUp({ sites: true });

      const res = await postCheckIn(await at(alex, MORNING), site.id);

      expect(res.status).toBe(201);
      expect(await recordsOf(alex)).toHaveLength(0);
      const [visit] = await visitsOf(alex);
      expect(visit).toMatchObject({ attendanceRecordId: null, flags: [] });
      expect(visit!.workDate.toISOString().slice(0, 10)).toBe("2026-11-03");
    });
  });

  describe("a day already started at the office", () => {
    it("only the visit is recorded, and the record doesn't change", async () => {
      const { alex, site } = await setUp();
      const token = await at(alex, colombo("03", "09:00:00"));
      await postDayCheckIn(token);
      const [before] = await recordsOf(alex);

      const res = await postCheckIn(await at(alex, MORNING), site.id);

      expect(res.status).toBe(201);
      const [after] = await recordsOf(alex);
      expect(after).toEqual(before);
      expect((await visitsOf(alex))[0]).toMatchObject({ attendanceRecordId: before!.id, flags: [] });
    });
  });

  describe("a day that has closed: AFTER_HOURS", () => {
    it("after a day check-out: linked, flagged, and the record doesn't change", async () => {
      const { alex, manager, site } = await setUp();
      await postDayCheckIn(await at(alex, colombo("03", "09:00:00")));
      await postDayCheckOut(await at(alex, colombo("03", "17:00:00")));
      const [before] = await recordsOf(alex);

      const res = await postCheckIn(await at(alex, colombo("03", "18:00:00")), site.id);

      expect(res.status).toBe(201);
      expect(res.body.visit.flags).toEqual(["AFTER_HOURS"]);
      expect(res.body.visit.attendanceRecordId).toBe(before!.id);
      expect((await recordsOf(alex))[0]).toEqual(before);
      expect(await notificationsOf(manager)).toHaveLength(1);
    });

    it("a record past its close time, with no check-out", async () => {
      const { alex, site } = await setUp();
      await postDayCheckIn(await at(alex, colombo("03", "09:00:00")));
      const [before] = await recordsOf(alex);

      const res = await postCheckIn(await at(alex, colombo("03", "21:30:00")), site.id);

      expect(res.body.visit.flags).toEqual(["AFTER_HOURS"]);
      expect(res.body.visit.attendanceRecordId).toBe(before!.id);
      expect((await recordsOf(alex))[0]).toEqual(before);
    });

    it("a record the job auto-closed", async () => {
      const { alex, company, site } = await setUp();
      await platformPrisma.attendanceRecord.create({
        data: {
          companyId: company.id,
          employeeId: alex.employeeId,
          workDate: new Date("2026-11-03"),
          status: "INCOMPLETE",
          source: "MOBILE",
          checkInAt: colombo("03", "09:00:00"),
          scheduledEndAt: colombo("03", "20:00:00"),
          autoClosedAt: colombo("03", "09:30:00"),
          flags: ["AUTO_CLOSED"],
        },
      });
      const [before] = await recordsOf(alex);

      const res = await postCheckIn(await at(alex, MORNING), site.id);

      expect(res.body.visit.flags).toEqual(["AFTER_HOURS"]);
      expect((await recordsOf(alex))[0]).toEqual(before);
    });

    it.each(["ON_LEAVE", "HOLIDAY"] as const)("a %s row day close wrote: left alone", async (status) => {
      const { alex, company, site } = await setUp();
      const row = await systemRow(company, alex, "2026-11-03", status);

      const res = await postCheckIn(await at(alex, MORNING), site.id);

      expect(res.status).toBe(201);
      expect(res.body.visit.flags).toEqual(["AFTER_HOURS"]);
      expect(res.body.visit.attendanceRecordId).toBe(row.id);
      expect((await recordsOf(alex))[0]).toEqual(row);
    });

    it("past the close time with no row: flagged, unlinked, and no record is made", async () => {
      const { alex, manager, site } = await setUp();

      const res = await postCheckIn(await at(alex, colombo("03", "21:30:00")), site.id);

      expect(res.status).toBe(201);
      expect(res.body.visit.flags).toEqual(["AFTER_HOURS"]);
      expect(res.body.visit.attendanceRecordId).toBeNull();
      expect(res.body.visit.workDate).toBe("2026-11-03");
      expect(await recordsOf(alex)).toHaveLength(0);
      expect(await notificationsOf(manager)).toHaveLength(1);
    });
  });

  describe("a day marked ABSENT: ON_ABSENT_DAY", () => {
    it("recorded, linked and flagged. The row is left alone, and the manager is told", async () => {
      const { alex, manager, company, site } = await setUp();
      const row = await systemRow(company, alex, "2026-11-03", "ABSENT");

      const res = await postCheckIn(await at(alex, MORNING), site.id);

      expect(res.status).toBe(201);
      expect(res.body.visit.flags).toEqual(["ON_ABSENT_DAY"]);
      expect(res.body.visit.flags).not.toContain("AFTER_HOURS");
      expect(res.body.visit.attendanceRecordId).toBe(row.id);
      expect((await recordsOf(alex))[0]).toEqual(row);
      expect(await notificationsOf(manager)).toHaveLength(1);
    });
  });

  describe("check-in rules", () => {
    it("the response has exactly the visit's fields", async () => {
      const { alex, site } = await setUp();

      const res = await postCheckIn(await at(alex, MORNING), site.id, { note: "Gate 2" });

      const visit = SiteVisitWithCoordinatesSchema.strict().parse(res.body.visit);
      expect(visit).toMatchObject({ siteName: site.name, employeeName: "Test User", note: "Gate 2", durationMinutes: null });
    });

    it("a second visit while one is open: VISIT_ALREADY_OPEN, naming the open site", async () => {
      const { alex, company, site } = await setUp();
      const first = await checkedIn(alex, site.id);
      const other = await addSite(company);

      const res = await postCheckIn(await at(alex, MORNING), other.id);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("VISIT_ALREADY_OPEN");
      expect(res.body.error.message).toBe(`Check out of ${site.name} first.`);
      expect(res.body.error.details).toEqual({ visit: { id: first.id, siteName: site.name } });
      expect(await visitsOf(alex)).toHaveLength(1);
    });

    it("an unknown site: 404", async () => {
      const { alex } = await setUp();

      expect((await postCheckIn(await at(alex, MORNING), newId())).status).toBe(404);
      expect(await recordsOf(alex)).toHaveLength(0);
    });

    it.each([
      ["inactive", { isActive: false }],
      ["office", { type: "OFFICE" }],
    ])("%s site: 404, and nothing is written", async (_label, extra) => {
      const { alex, company } = await setUp();
      const site = await addSite(company, extra);

      expect((await postCheckIn(await at(alex, MORNING), site.id)).status).toBe(404);
      expect(await recordsOf(alex)).toHaveLength(0);
      expect(await visitsOf(alex)).toHaveLength(0);
    });

    it("ignores a work date, time, status or company in the body", async () => {
      const { alex, company, site } = await setUp();
      const otherCompany = await setUpCompany();

      await postCheckIn(await at(alex, MORNING), site.id, {
        workDate: "2020-01-01",
        checkInAt: "2020-01-01T00:00:00.000Z",
        status: "CLOSED",
        companyId: otherCompany.id,
        flags: ["AFTER_HOURS"],
      });

      const [visit] = await visitsOf(alex);
      expect(visit).toMatchObject({ companyId: company.id, status: "OPEN", flags: [] });
      expect(visit!.checkInAt).toEqual(MORNING);
    });
  });

  describe("retries", () => {
    it("the same request id gets the same visit back: 200, and no second notification", async () => {
      const { alex, manager, site } = await setUp();
      const token = await at(alex, MORNING);
      const clientRequestId = newId();

      const first = await postCheckIn(token, site.id, { clientRequestId });
      const again = await postCheckIn(token, site.id, { clientRequestId });

      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body.visit.id).toBe(first.body.visit.id);
      expect(await visitsOf(alex)).toHaveLength(1);
      expect(await notificationsOf(manager)).toHaveLength(1);
    });

    it("a retry still works after the visit closed and the site was deactivated", async () => {
      const { alex, site } = await setUp();
      const token = await at(alex, MORNING);
      const clientRequestId = newId();
      const first = await postCheckIn(token, site.id, { clientRequestId });
      await postCheckOut(await at(alex, new Date(MORNING.getTime() + 60_000)), first.body.visit.id);
      await platformPrisma.site.update({ where: { id: site.id }, data: { isActive: false } });

      const again = await postCheckIn(token, site.id, { clientRequestId });

      expect(again.status).toBe(200);
      expect(again.body.visit.status).toBe("CLOSED");
    });

    it("one employee's request id neither finds nor blocks another's visit", async () => {
      const { alex, company, site } = await setUp();
      const sam = await addPerson(company);
      const clientRequestId = newId();

      const first = await postCheckIn(await at(alex, MORNING), site.id, { clientRequestId });
      const second = await postCheckIn(await at(sam, MORNING), site.id, { clientRequestId });

      expect(second.status).toBe(201);
      expect(second.body.visit.id).not.toBe(first.body.visit.id);
    });
  });

  describe("simultaneous requests", () => {
    it("two different tabs: one visit, one record, one notification, one VISIT_ALREADY_OPEN", async () => {
      const { alex, manager, company, site } = await setUp();
      const other = await addSite(company);
      const token = await at(alex, MORNING);

      const results = await Promise.all([postCheckIn(token, site.id), postCheckIn(token, other.id)]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe("VISIT_ALREADY_OPEN");
      expect(await visitsOf(alex)).toHaveLength(1);
      expect(await recordsOf(alex)).toHaveLength(1);
      expect(await notificationsOf(manager)).toHaveLength(1);
    });

    it("the same tap twice: both get the one visit", async () => {
      const { alex, manager, site } = await setUp();
      const token = await at(alex, MORNING);
      const clientRequestId = newId();

      const results = await Promise.all([
        postCheckIn(token, site.id, { clientRequestId }),
        postCheckIn(token, site.id, { clientRequestId }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(results[0]!.body.visit.id).toBe(results[1]!.body.visit.id);
      expect(await notificationsOf(manager)).toHaveLength(1);
    });

    it("a site check-in racing an office check-in: one record, and the visit is still recorded", async () => {
      const { alex, site } = await setUp();
      const token = await at(alex, MORNING);

      const [visit] = await Promise.all([postCheckIn(token, site.id), postDayCheckIn(token)]);

      expect(visit.status).toBe(201);
      const records = await recordsOf(alex);
      expect(records).toHaveLength(1);
      expect((await visitsOf(alex))[0]!.attendanceRecordId).toBe(records[0]!.id);
    });
  });

  describe("GPS at check-in", () => {
    it("no location at a site that requires it: LOCATION_REQUIRED, and nothing is written or audited", async () => {
      const { alex, manager, company } = await setUp();
      const site = await gpsSite(company);

      const res = await postCheckIn(await at(alex, MORNING), site.id);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("LOCATION_REQUIRED");
      expect(await recordsOf(alex)).toHaveLength(0);
      expect(await visitsOf(alex)).toHaveLength(0);
      expect(await notificationsOf(manager)).toHaveLength(0);
      expect(await platformPrisma.auditLog.count({ where: { companyId: company.id, action: "ATTENDANCE_CHECKIN_REJECTED" } })).toBe(0);
    });

    it("too far away: OUTSIDE_SITE_RADIUS with the distance, and the day isn't started", async () => {
      const { alex, company } = await setUp();
      const site = await gpsSite(company, { name: "Warehouse" });

      const res = await postCheckIn(await at(alex, MORNING), site.id, { location: fix(1000) });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: "OUTSIDE_SITE_RADIUS", details: { distanceM: 1000, radiusM: 200, siteName: "Warehouse" } });
      expect(await recordsOf(alex)).toHaveLength(0);
      expect(await visitsOf(alex)).toHaveLength(0);
    });

    it("a mock location: rejected, with an audit row that holds no coordinates", async () => {
      const { alex, company } = await setUp();
      const site = await gpsSite(company);

      const res = await postCheckIn(await at(alex, MORNING), site.id, { location: fix(10, { mocked: true }) });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("MOCK_LOCATION_DETECTED");
      expect(await visitsOf(alex)).toHaveLength(0);
      const audit = await platformPrisma.auditLog.findFirstOrThrow({ where: { companyId: company.id, action: "ATTENDANCE_CHECKIN_REJECTED" } });
      expect(audit.metadata).toEqual({ reason: "MOCK_LOCATION_DETECTED", siteId: site.id });
      expect(JSON.stringify(audit)).not.toContain(String(SITE_AT.longitude));
    });

    it("within the radius: stored on the visit, not on the attendance record", async () => {
      const { alex, company } = await setUp();
      const site = await gpsSite(company);

      const res = await postCheckIn(await at(alex, MORNING), site.id, { location: fix(150) });

      expect(res.status).toBe(201);
      expect(res.body.visit).toMatchObject({ checkInDistanceM: 150, checkInWithinRadius: true, checkInAccuracyM: 10, checkInMocked: false, flags: [] });
      expect(res.body.visit.checkInLng).toBe(SITE_AT.longitude);
      expect((await recordsOf(alex))[0]).toMatchObject({ checkInLat: null, checkInDistanceM: null });
    });

    it("a poor fix that can't tell: allowed and flagged LOW_ACCURACY", async () => {
      const { alex, company } = await setUp();
      const site = await gpsSite(company);

      const res = await postCheckIn(await at(alex, MORNING), site.id, { location: fix(150, { accuracy: 300 }) });

      expect(res.status).toBe(201);
      expect(res.body.visit.flags).toEqual(["LOW_ACCURACY"]);
    });

    it("a stale fix keeps the day flag too", async () => {
      const { alex, company } = await setUp();
      const site = await gpsSite(company);
      await systemRow(company, alex, "2026-11-03", "ABSENT");

      const res = await postCheckIn(await at(alex, MORNING), site.id, {
        location: fix(10, { capturedAt: new Date(MORNING.getTime() - 3 * 60_000).toISOString() }),
      });

      expect(res.body.visit.flags).toEqual(["ON_ABSENT_DAY", "STALE_LOCATION"]);
    });

    it("the state errors come before GPS", async () => {
      const { alex, company, site } = await setUp();
      await checkedIn(alex, site.id);
      const required = await gpsSite(company);

      const res = await postCheckIn(await at(alex, MORNING), required.id);

      expect(res.body.error.code).toBe("VISIT_ALREADY_OPEN");
    });

    it("a location sent to a site that doesn't require GPS is discarded (Q6)", async () => {
      const { alex, site } = await setUp();

      const res = await postCheckIn(await at(alex, MORNING), site.id, { location: fix(99_000, { mocked: true }) });

      expect(res.status).toBe(201);
      expect((await visitsOf(alex))[0]).toMatchObject({
        checkInLat: null,
        checkInLng: null,
        checkInAccuracyM: null,
        checkInDistanceM: null,
        checkInWithinRadius: null,
        checkInMocked: null,
        flags: [],
      });
    });
  });

  describe("site check-out", () => {
    it("computes the duration, and doesn't end the attendance day", async () => {
      const { alex, site } = await setUp();
      const visit = await checkedIn(alex, site.id, colombo("03", "10:00:00"));

      const res = await postCheckOut(await at(alex, colombo("03", "11:30:30")), visit.id);

      expect(res.status).toBe(200);
      expect(res.body.visit).toMatchObject({ status: "CLOSED", durationMinutes: 90 });
      expect(res.body.visit.checkOutAt).toBe(colombo("03", "11:30:30").toISOString());
      const [record] = await recordsOf(alex);
      expect(record).toMatchObject({ checkOutAt: null, workedMinutes: null });
      expect((await get(await at(alex, colombo("03", "11:31:00")), "/attendance/me/today")).body.nextAction).toBe("CHECK_OUT");
    });

    it("a second check-out: VISIT_NOT_OPEN, and the first stands", async () => {
      const { alex, site } = await setUp();
      const visit = await checkedIn(alex, site.id, colombo("03", "10:00:00"));
      await postCheckOut(await at(alex, colombo("03", "11:00:00")), visit.id);

      const res = await postCheckOut(await at(alex, colombo("03", "12:00:00")), visit.id);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("VISIT_NOT_OPEN");
      expect((await visitsOf(alex))[0]!.durationMinutes).toBe(60);
    });

    it("two at once: one wins", async () => {
      const { alex, site } = await setUp();
      const visit = await checkedIn(alex, site.id, colombo("03", "10:00:00"));
      const token = await at(alex, colombo("03", "11:00:00"));

      const results = await Promise.all([postCheckOut(token, visit.id), postCheckOut(token, visit.id)]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it("a note is added to the check-in's note", async () => {
      const { alex, site } = await setUp();
      const res = await postCheckIn(await at(alex, MORNING), site.id, { note: "Arrived" });

      const out = await postCheckOut(await at(alex, new Date(MORNING.getTime() + 60_000)), res.body.visit.id, { note: "Fixed" });

      expect(out.body.visit.note).toBe("Arrived\nFixed");
    });

    it.each(["EMPLOYEE", "MANAGER", "HR", "COMPANY_ADMIN"] as const)("%s can't check someone else out: 404", async (role) => {
      const { alex, company, site } = await setUp();
      const visit = await checkedIn(alex, site.id);
      const other = await addPerson(company, role);

      const res = await postCheckOut(await at(other, new Date(MORNING.getTime() + 60_000)), visit.id);

      expect(res.status).toBe(404);
      expect((await visitsOf(alex))[0]!.status).toBe("OPEN");
    });

    it("a deactivated site still closes normally, with its GPS rules", async () => {
      const { alex, company } = await setUp();
      const site = await gpsSite(company);
      const res = await postCheckIn(await at(alex, MORNING), site.id, { location: fix(10) });
      await platformPrisma.site.update({ where: { id: site.id }, data: { isActive: false } });

      const out = await postCheckOut(await at(alex, new Date(MORNING.getTime() + 60_000)), res.body.visit.id, { location: fix(20) });

      expect(out.status).toBe(200);
      expect(out.body.visit).toMatchObject({ status: "CLOSED", checkOutDistanceM: 20, checkOutWithinRadius: true });
    });

    describe("GPS never rejects a check-out", () => {
      it.each([
        ["no location", undefined, ["LOCATION_UNAVAILABLE_AT_CHECKOUT"]],
        ["outside the radius", fix(1000), ["OUTSIDE_RADIUS_AT_CHECKOUT"]],
        ["a mock location", fix(10, { mocked: true }), ["MOCK_LOCATION_AT_CHECKOUT"]],
        ["a poor fix", fix(10, { accuracy: 500 }), ["LOW_ACCURACY"]],
      ])("%s: closed and flagged", async (_label, location, flags) => {
        const { alex, company } = await setUp();
        const site = await gpsSite(company);
        const res = await postCheckIn(await at(alex, MORNING), site.id, { location: fix(10) });

        const out = await postCheckOut(await at(alex, MORNING), res.body.visit.id, location ? { location: { ...location, capturedAt: MORNING.toISOString() } } : {});

        expect(out.status).toBe(200);
        expect(out.body.visit.status).toBe("CLOSED");
        expect(out.body.visit.flags).toEqual(flags);
      });

      it("a location sent to a site that doesn't require GPS is discarded", async () => {
        const { alex, site } = await setUp();
        const visit = await checkedIn(alex, site.id);

        const out = await postCheckOut(await at(alex, new Date(MORNING.getTime() + 60_000)), visit.id, { location: fix(99_000) });

        expect(out.body.visit).toMatchObject({ checkOutLat: null, checkOutDistanceM: null, flags: [] });
      });
    });
  });

  describe("a day check-out closes an open visit", () => {
    it("at the same instant, in the same request", async () => {
      const { alex, site } = await setUp();
      await checkedIn(alex, site.id, colombo("03", "10:00:00"));
      const when = colombo("03", "16:00:00");

      const res = await postDayCheckOut(await at(alex, when));

      expect(res.status).toBe(200);
      const [visit] = await visitsOf(alex);
      const [record] = await recordsOf(alex);
      expect(visit).toMatchObject({ status: "CLOSED", durationMinutes: 360 });
      expect(visit!.checkOutAt).toEqual(when);
      expect(record!.checkOutAt).toEqual(when);
    });

    it("its site decides what's kept: a GPS site keeps the location, and the office that doesn't check doesn't", async () => {
      const { alex, company } = await setUp();
      const office = await addSite(company, { type: "OFFICE" });
      const site = await gpsSite(company);
      await postDayCheckIn(await at(alex, colombo("03", "09:00:00")));
      expect((await recordsOf(alex))[0]!.checkInSiteId).toBe(office.id);
      await postCheckIn(await at(alex, MORNING), site.id, { location: fix(10) });

      await postDayCheckOut(await at(alex, colombo("03", "16:00:00")), { location: fix(1000) });

      const [visit] = await visitsOf(alex);
      const [record] = await recordsOf(alex);
      expect(visit).toMatchObject({ checkOutDistanceM: 1000, checkOutWithinRadius: false, flags: ["OUTSIDE_RADIUS_AT_CHECKOUT"] });
      expect(record).toMatchObject({ checkOutLat: null, checkOutDistanceM: null, flags: [] });
    });

    it("a site that doesn't require GPS discards the location, while the office keeps it", async () => {
      const { alex, company, site } = await setUp();
      await gpsSite(company, { type: "OFFICE" });
      const token = await at(alex, colombo("03", "09:00:00"));
      await request(app)
        .post("/api/v1/attendance/check-in")
        .set("Authorization", token)
        .send({ clientRequestId: newId(), location: fix(10, { capturedAt: colombo("03", "09:00:00").toISOString() }) });
      await checkedIn(alex, site.id);

      await postDayCheckOut(await at(alex, colombo("03", "16:00:00")), { location: fix(20) });

      expect((await visitsOf(alex))[0]).toMatchObject({ status: "CLOSED", checkOutLat: null, checkOutDistanceM: null });
      expect((await recordsOf(alex))[0]).toMatchObject({ checkOutDistanceM: 20 });
    });

    it("a GPS site with no location: the visit is flagged, and the check-out still goes through", async () => {
      const { alex, company } = await setUp();
      const site = await gpsSite(company);
      await postCheckIn(await at(alex, MORNING), site.id, { location: fix(10) });

      const res = await postDayCheckOut(await at(alex, colombo("03", "16:00:00")));

      expect(res.status).toBe(200);
      expect((await visitsOf(alex))[0]).toMatchObject({ status: "CLOSED", flags: ["LOCATION_UNAVAILABLE_AT_CHECKOUT"] });
    });

    it("an already closed visit isn't touched", async () => {
      const { alex, site } = await setUp();
      const visit = await checkedIn(alex, site.id, colombo("03", "10:00:00"));
      await postCheckOut(await at(alex, colombo("03", "11:00:00")), visit.id);

      await postDayCheckOut(await at(alex, colombo("03", "16:00:00")));

      expect((await visitsOf(alex))[0]!.durationMinutes).toBe(60);
    });

    it("a refused day check-out leaves the visit open", async () => {
      const { alex, site } = await setUp();
      await postDayCheckIn(await at(alex, colombo("03", "09:00:00")));
      await postDayCheckOut(await at(alex, colombo("03", "16:00:00")));
      await checkedIn(alex, site.id, colombo("03", "17:00:00"));

      const res = await postDayCheckOut(await at(alex, colombo("03", "18:00:00")));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ALREADY_CHECKED_OUT");
      expect((await visitsOf(alex))[0]!.status).toBe("OPEN");
    });

    it("someone else's open visit isn't touched", async () => {
      const { alex, company, site } = await setUp();
      const sam = await addPerson(company);
      await checkedIn(sam, site.id);
      await postDayCheckIn(await at(alex, colombo("03", "09:00:00")));

      await postDayCheckOut(await at(alex, colombo("03", "16:00:00")));

      expect((await visitsOf(sam))[0]!.status).toBe("OPEN");
    });

    it("with sites switched off since: it's still closed, and no position is kept", async () => {
      const { alex, company } = await setUp();
      const site = await gpsSite(company);
      await postCheckIn(await at(alex, MORNING), site.id, { location: fix(10) });
      await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { enabledModules: { attendance: true } } });
      invalidateEnabledModulesCache(company.id);

      const res = await postDayCheckOut(await at(alex, colombo("03", "16:00:00")), { location: fix(1000) });

      expect(res.status).toBe(200);
      expect((await visitsOf(alex))[0]).toMatchObject({ status: "CLOSED", checkOutLat: null, checkOutDistanceM: null, flags: [] });
    });
  });

  describe("GET /attendance/me/today", () => {
    it("names the open visit, without coordinates", async () => {
      const { alex, site } = await setUp();
      const visit = await checkedIn(alex, site.id);

      const res = await get(await at(alex, MORNING), "/attendance/me/today");

      expect(res.body.openVisit).toEqual({ id: visit.id, siteName: site.name, checkInAt: MORNING.toISOString() });
      expect(res.body.gpsRequired).toBe(false);
    });

    it("no open visit: null", async () => {
      const { alex } = await setUp();

      expect((await get(await at(alex, MORNING), "/attendance/me/today")).body.openVisit).toBeNull();
    });

    it("an open visit at a GPS site means the day check-out tap should read the location", async () => {
      const { alex, company } = await setUp();
      const site = await gpsSite(company);
      await postCheckIn(await at(alex, MORNING), site.id, { location: fix(10) });

      const res = await get(await at(alex, MORNING), "/attendance/me/today");

      expect(res.body).toMatchObject({ nextAction: "CHECK_OUT", gpsRequired: true, officeSite: null });
    });

    it("with sites off: null, and the visit no longer asks for a location", async () => {
      const { alex, company } = await setUp();
      const site = await gpsSite(company);
      await postCheckIn(await at(alex, MORNING), site.id, { location: fix(10) });
      await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { enabledModules: { attendance: true } } });
      invalidateEnabledModulesCache(company.id);

      const res = await get(await at(alex, MORNING), "/attendance/me/today");

      expect(res.body).toMatchObject({ openVisit: null, gpsRequired: false });
    });
  });

  describe("GET /site-visits/me/open", () => {
    it("the open visit, with whether its check-out needs a location", async () => {
      const { alex, company } = await setUp();
      const site = await gpsSite(company);
      await postCheckIn(await at(alex, MORNING), site.id, { location: fix(10) });

      const res = await get(await at(alex, MORNING), "/site-visits/me/open");

      expect(res.status).toBe(200);
      expect(() => OpenSiteVisitResponseSchema.parse(res.body)).not.toThrow();
      expect(res.body.gpsRequired).toBe(true);
      expect(res.body.visit.siteName).toBe(site.name);
    });

    it("none: null", async () => {
      const { alex } = await setUp();

      expect((await get(await at(alex, MORNING), "/site-visits/me/open")).body).toEqual({ visit: null, gpsRequired: false });
    });

    it("only my own", async () => {
      const { alex, company, site } = await setUp();
      const sam = await addPerson(company);
      await checkedIn(sam, site.id);

      expect((await get(await at(alex, MORNING), "/site-visits/me/open")).body.visit).toBeNull();
    });
  });

  describe("the manager's notification", () => {
    describe.each(TEST_TIMEZONES)("with server TZ=$tz", ({ tz, offsetMinutes }) => {
      useProcessTimezone(tz, offsetMinutes);

      it("names the person, the site and the company-local time, and points at the visit", async () => {
        const { alex, manager, company } = await setUp();
        await platformPrisma.employee.update({ where: { id: alex.employeeId }, data: { firstName: "Alex", lastName: "Silva" } });
        const site = await addSite(company, { name: "Site X" });

        const res = await postCheckIn(await at(alex, colombo("03", "10:42:00")), site.id);

        const [notification] = await notificationsOf(manager);
        expect(notification).toMatchObject({
          companyId: company.id,
          type: "SITE_CHECKED_IN",
          body: "Alex Silva checked in at Site X, 10:42",
          relatedEntityType: "SiteVisit",
          relatedEntityId: res.body.visit.id,
          readAt: null,
        });
      });
    });

    it("appears on the manager's bell", async () => {
      const { alex, manager, site } = await setUp();
      await checkedIn(alex, site.id);

      const res = await get(await at(manager, MORNING), "/notifications/unread-count");

      expect(res.body.count).toBe(1);
    });

    it("goes only to the manager: not the employee, HR or another manager", async () => {
      const { alex, company, site } = await setUp();
      const hr = await addPerson(company, "HR");
      const otherManager = await addPerson(company, "MANAGER");

      await checkedIn(alex, site.id);

      expect(await notificationsOf(alex)).toHaveLength(0);
      expect(await notificationsOf(hr)).toHaveLength(0);
      expect(await notificationsOf(otherManager)).toHaveLength(0);
    });

    it("no manager: the check-in still works", async () => {
      const company = await setUpCompany();
      const alex = await addPerson(company);
      const site = await addSite(company);

      expect((await postCheckIn(await at(alex, MORNING), site.id)).status).toBe(201);
      expect(await platformPrisma.notification.count({ where: { companyId: company.id } })).toBe(0);
    });

    it("a manager with a deactivated login isn't notified", async () => {
      const { alex, manager, site } = await setUp();
      await platformPrisma.user.update({ where: { id: manager.userId }, data: { status: "DEACTIVATED" } });

      expect((await postCheckIn(await at(alex, MORNING), site.id)).status).toBe(201);
      expect(await notificationsOf(manager)).toHaveLength(0);
    });

    it("a check-out sends nothing more", async () => {
      const { alex, manager, site } = await setUp();
      const visit = await checkedIn(alex, site.id);

      await postCheckOut(await at(alex, new Date(MORNING.getTime() + 60_000)), visit.id);

      expect(await notificationsOf(manager)).toHaveLength(1);
    });
  });

  describe("lists", () => {
    /** Alex (the manager's report) with one closed GPS visit on the 3rd and one open on
     * the 4th, and Sam (no manager) with one open. */
    async function withVisits() {
      const { company, manager, alex, site } = await setUp();
      const sam = await addPerson(company);
      const gps = await gpsSite(company);
      const first = await postCheckIn(await at(alex, colombo("03", "10:00:00")), gps.id, { location: fix(10) });
      await postCheckOut(await at(alex, colombo("03", "11:00:00")), first.body.visit.id, { location: fix(20) });
      const second = await checkedIn(alex, site.id, colombo("04", "10:00:00"));
      const samVisit = await checkedIn(sam, site.id, colombo("04", "10:30:00"));
      return { company, manager, alex, sam, site, gps, firstId: first.body.visit.id as string, secondId: second.id, samVisitId: samVisit.id };
    }
    const LATER = colombo("04", "12:00:00");
    const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((visit) => visit.id);

    describe("GET /site-visits/me", () => {
      it("my visits, newest first, with my own coordinates", async () => {
        const { alex, firstId, secondId } = await withVisits();

        const res = await get(await at(alex, LATER), "/site-visits/me");

        expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
        expect(ids(res)).toEqual([secondId, firstId]);
        expect(res.body.data[1].checkInLng).toBe(SITE_AT.longitude);
        expect(res.body.data[1].durationMinutes).toBe(60);
      });

      it("filters by date, and paginates", async () => {
        const { alex, firstId, secondId } = await withVisits();
        const token = await at(alex, LATER);

        expect(ids(await get(token, "/site-visits/me?from=2026-11-03&to=2026-11-03"))).toEqual([firstId]);
        expect(ids(await get(token, "/site-visits/me?from=2026-11-04"))).toEqual([secondId]);
        const page = await get(token, "/site-visits/me?pageSize=1&page=2");
        expect(ids(page)).toEqual([firstId]);
        expect(page.body.total).toBe(2);
      });
    });

    describe("GET /site-visits/team", () => {
      it("my direct reports only, and no coordinates", async () => {
        const { manager, firstId, secondId } = await withVisits();

        const res = await get(await at(manager, LATER), "/site-visits/team");

        expect(ids(res)).toEqual([secondId, firstId]);
        for (const visit of res.body.data) {
          expect(() => SiteVisitSchema.strict().parse(visit)).not.toThrow();
        }
        expect(res.body.data[1]).toMatchObject({ checkInDistanceM: 10, checkInWithinRadius: true, checkOutDistanceM: 20 });
        expect(JSON.stringify(res.body)).not.toContain(String(SITE_AT.longitude));
      });

      it("a report of a report isn't on my team", async () => {
        const { company, manager, alex, site } = await withVisits();
        const lead = await addPerson(company, "MANAGER", { managerId: manager.employeeId });
        const junior = await addPerson(company, "EMPLOYEE", { managerId: lead.employeeId });
        await checkedIn(junior, site.id, LATER);

        const res = await get(await at(manager, LATER), "/site-visits/team");

        expect(res.body.data.every((visit: { employeeId: string }) => visit.employeeId === alex.employeeId)).toBe(true);
      });

      it("filters by employee, site, date and open only", async () => {
        const { manager, alex, site, gps, firstId, secondId } = await withVisits();
        const token = await at(manager, LATER);

        expect(ids(await get(token, `/site-visits/team?employeeId=${alex.employeeId}`))).toEqual([secondId, firstId]);
        expect(ids(await get(token, `/site-visits/team?siteId=${gps.id}`))).toEqual([firstId]);
        expect(ids(await get(token, `/site-visits/team?siteId=${site.id}`))).toEqual([secondId]);
        expect(ids(await get(token, "/site-visits/team?openOnly=true"))).toEqual([secondId]);
        expect(ids(await get(token, "/site-visits/team?openOnly=false"))).toEqual([secondId, firstId]);
        expect(ids(await get(token, "/site-visits/team?to=2026-11-03"))).toEqual([firstId]);
      });

      it("an employeeId outside my team finds nothing", async () => {
        const { manager, sam } = await withVisits();

        const res = await get(await at(manager, LATER), `/site-visits/team?employeeId=${sam.employeeId}`);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ data: [], total: 0 });
      });

      it("a manager with no profile: NO_EMPLOYEE_PROFILE, not everyone with no manager", async () => {
        const { company } = await withVisits();
        const lead = await addPerson(company, "MANAGER", { profile: false });

        const res = await get(await at(lead, LATER), "/site-visits/team");

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("NO_EMPLOYEE_PROFILE");
      });
    });

    describe.each(["HR", "COMPANY_ADMIN"] as const)("GET /site-visits as %s", (role) => {
      it("everyone in the company, and no coordinates in the list", async () => {
        const { company, firstId, secondId, samVisitId } = await withVisits();
        const person = await addPerson(company, role);

        const res = await get(await at(person, LATER), "/site-visits");

        expect(ids(res)).toEqual([samVisitId, secondId, firstId]);
        for (const visit of res.body.data) {
          expect(() => SiteVisitSchema.strict().parse(visit)).not.toThrow();
        }
      });

      it("the same filters", async () => {
        const { company, sam, secondId, samVisitId } = await withVisits();
        const person = await addPerson(company, role);
        const token = await at(person, LATER);

        expect(ids(await get(token, "/site-visits?openOnly=true"))).toEqual([samVisitId, secondId]);
        expect(ids(await get(token, `/site-visits?employeeId=${sam.employeeId}`))).toEqual([samVisitId]);
      });
    });

    describe("GET /site-visits/:id", () => {
      it("the owner gets coordinates", async () => {
        const { alex, firstId } = await withVisits();

        const res = await get(await at(alex, LATER), `/site-visits/${firstId}`);

        expect(res.status).toBe(200);
        expect(res.body.visit.checkInLng).toBe(SITE_AT.longitude);
      });

      it.each(["HR", "COMPANY_ADMIN"] as const)("%s gets coordinates", async (role) => {
        const { company, firstId } = await withVisits();
        const person = await addPerson(company, role);

        expect((await get(await at(person, LATER), `/site-visits/${firstId}`)).body.visit.checkOutLng).toBe(SITE_AT.longitude);
      });

      it("their manager gets the visit with no coordinates", async () => {
        const { manager, firstId } = await withVisits();

        const res = await get(await at(manager, LATER), `/site-visits/${firstId}`);

        expect(res.status).toBe(200);
        expect(() => SiteVisitSchema.strict().parse(res.body.visit)).not.toThrow();
        expect(JSON.stringify(res.body)).not.toContain(String(SITE_AT.longitude));
      });

      it("another employee, or another manager: 404", async () => {
        const { company, sam, firstId } = await withVisits();
        const otherManager = await addPerson(company, "MANAGER");

        expect((await get(await at(sam, LATER), `/site-visits/${firstId}`)).status).toBe(404);
        expect((await get(await at(otherManager, LATER), `/site-visits/${firstId}`)).status).toBe(404);
      });
    });
  });

  describe("GET /attendance/:id", () => {
    it("lists the day's visits, with coordinates for the owner and none for the manager", async () => {
      const { alex, manager, company } = await setUp();
      const site = await gpsSite(company);
      const res = await postCheckIn(await at(alex, MORNING), site.id, { location: fix(10) });
      const recordId = res.body.visit.attendanceRecordId as string;

      const own = await get(await at(alex, MORNING), `/attendance/${recordId}`);
      const managers = await get(await at(manager, MORNING), `/attendance/${recordId}`);

      expect(own.body.siteVisits).toHaveLength(1);
      expect(own.body.siteVisits[0].checkInLng).toBe(SITE_AT.longitude);
      expect(managers.body.siteVisits).toHaveLength(1);
      expect(managers.body.siteVisits[0].siteName).toBe(site.name);
      expect(JSON.stringify(managers.body)).not.toContain(String(SITE_AT.longitude));
    });

    it("with sites off, there are none", async () => {
      const { alex, company, site } = await setUp();
      await checkedIn(alex, site.id);
      const recordId = (await visitsOf(alex))[0]!.attendanceRecordId!;
      await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { enabledModules: { attendance: true } } });
      invalidateEnabledModulesCache(company.id);

      expect((await get(await at(alex, MORNING), `/attendance/${recordId}`)).body.siteVisits).toEqual([]);
    });
  });

  describe("sites in use", () => {
    it("a site with a visit can't be deleted", async () => {
      const { alex, company, site } = await setUp();
      await checkedIn(alex, site.id);
      const hr = await addPerson(company, "HR");

      const res = await request(app).delete(`/api/v1/sites/${site.id}`).set("Authorization", await at(hr, MORNING));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SITE_IN_USE");
    });
  });

  describe("tenant isolation", () => {
    async function twoCompanies() {
      const a = await setUp();
      const b = await setUp();
      const visitB = await checkedIn(b.alex, b.site.id);
      return { a, b, visitB };
    }

    it("Company A can't check in at Company B's site", async () => {
      const { a, b } = await twoCompanies();

      expect((await postCheckIn(await at(a.alex, MORNING), b.site.id)).status).toBe(404);
      expect(await visitsOf(a.alex)).toHaveLength(0);
      expect(await recordsOf(a.alex)).toHaveLength(0);
    });

    it("Company A can't check out of Company B's visit", async () => {
      const { a, b, visitB } = await twoCompanies();

      expect((await postCheckOut(await at(a.alex, MORNING), visitB.id)).status).toBe(404);
      expect((await visitsOf(b.alex))[0]!.status).toBe("OPEN");
    });

    it.each(["EMPLOYEE", "MANAGER", "HR", "COMPANY_ADMIN"] as const)("%s in Company A can't read Company B's visit", async (role) => {
      const { a, visitB } = await twoCompanies();
      const person = await addPerson(a.company, role);

      expect((await get(await at(person, MORNING), `/site-visits/${visitB.id}`)).status).toBe(404);
    });

    it("Company A's lists don't include Company B's visits, even when asked for by id", async () => {
      const { a, b } = await twoCompanies();
      const hr = await addPerson(a.company, "HR");
      const hrToken = await at(hr, MORNING);

      expect((await get(hrToken, "/site-visits")).body.total).toBe(0);
      expect((await get(hrToken, `/site-visits?employeeId=${b.alex.employeeId}`)).body.total).toBe(0);
      expect((await get(hrToken, `/site-visits?siteId=${b.site.id}`)).body.total).toBe(0);
      expect((await get(await at(a.manager, MORNING), `/site-visits/team?employeeId=${b.alex.employeeId}`)).body.total).toBe(0);
      expect((await get(await at(a.alex, MORNING), "/site-visits/me")).body.total).toBe(0);
    });

    it("each manager only hears about their own company's visit", async () => {
      const { a, b } = await twoCompanies();
      const visitA = await checkedIn(a.alex, a.site.id);

      expect((await notificationsOf(a.manager)).map((n) => n.relatedEntityId)).toEqual([visitA.id]);
      expect((await notificationsOf(b.manager)).map((n) => n.relatedEntityId)).not.toContain(visitA.id);
    });
  });

  describe("database rules", () => {
    async function row(company: Company, person: Person, siteId: string, data: object = {}) {
      return platformPrisma.siteVisit.create({
        data: {
          companyId: company.id,
          employeeId: person.employeeId,
          siteId,
          workDate: new Date("2026-11-03"),
          checkInAt: MORNING,
          clientRequestId: newId(),
          ...data,
        },
      });
    }

    it("one open visit per employee, whatever the code does", async () => {
      const { alex, company, site } = await setUp();
      await row(company, alex, site.id);

      await expect(row(company, alex, site.id)).rejects.toThrow();
    });

    it("many closed visits are fine", async () => {
      const { alex, company, site } = await setUp();
      const closed = { status: "CLOSED", checkOutAt: new Date(MORNING.getTime() + 1) };
      await row(company, alex, site.id, closed);

      await expect(row(company, alex, site.id, closed)).resolves.toBeTruthy();
    });

    it.each([
      ["a check-out before the check-in", { status: "CLOSED", checkOutAt: new Date(MORNING.getTime() - 1) }],
      ["a closed visit with no check-out", { status: "CLOSED" }],
      ["an open visit with a check-out", { status: "OPEN", checkOutAt: new Date(MORNING.getTime() + 1) }],
      ["a negative duration", { status: "CLOSED", checkOutAt: new Date(MORNING.getTime() + 1), durationMinutes: -1 }],
    ])("refuses %s", async (_label, data) => {
      const { alex, company, site } = await setUp();

      await expect(row(company, alex, site.id, data)).rejects.toThrow();
    });

    it("an auto-closed visit may have no check-out", async () => {
      const { alex, company, site } = await setUp();

      await expect(row(company, alex, site.id, { status: "AUTO_CLOSED" })).resolves.toBeTruthy();
    });
  });
});
