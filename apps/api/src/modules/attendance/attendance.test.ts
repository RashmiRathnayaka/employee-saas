import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { AttendanceRecordSchema, AttendanceRecordWithCoordinatesSchema, AttendanceTodaySchema } from "@employee-saas/shared";
import { createApp } from "../../app.js";
import { invalidateEnabledModulesCache } from "../../lib/enabledModules.js";
import { platformPrisma } from "../../lib/prisma.js";
import { createTestCompany, createTestUser, DEFAULT_TEST_PASSWORD, platformLoginAs } from "../../test/helpers.js";
import { TEST_TIMEZONES, useProcessTimezone } from "../../test/timezone.js";

const app = createApp();

/** A time on the wall clock in Colombo, where the test companies are. 2 Nov 2026 is
 * a Monday, so the 3rd is a Tuesday, the 7th a Saturday and the 8th a Sunday. */
const colombo = (date: string, time: string) => new Date(`2026-11-${date}T${time}+05:30`);

type Person = { email: string; companyCode: string; employeeId: string | undefined };
const tokens = new Map<string, string>();

/**
 * Moves the clock and returns a logged-in header for this person. Only `Date` is
 * faked: real timers keep running, so database calls and timeouts behave normally.
 * A token only lasts minutes, so a test that jumps hours logs in again at the new
 * time. Tokens are reused otherwise, because login is rate-limited per company.
 */
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

async function setUpCompany(settings: Record<string, unknown> = {}, modules: Record<string, boolean> = { attendance: true }) {
  const company = await createTestCompany();
  await platformPrisma.companySettings.update({
    where: { companyId: company.id },
    data: { enabledModules: modules, ...settings },
  });
  invalidateEnabledModulesCache(company.id);
  return company;
}

async function addPerson(
  company: { id: string; code: string },
  role: "EMPLOYEE" | "MANAGER" | "HR" | "COMPANY_ADMIN" = "EMPLOYEE",
  options: { profile?: boolean } = {},
): Promise<Person> {
  const suffix = crypto.randomBytes(3).toString("hex");
  const email = `${role.toLowerCase()}-${suffix}@example.test`;
  const { employeeId } = await createTestUser({
    companyId: company.id,
    role,
    email,
    employeeCode: options.profile === false ? undefined : `E${suffix}`,
  });
  return { email, companyCode: company.code, employeeId };
}

async function setUp(settings: Record<string, unknown> = {}) {
  const company = await setUpCompany(settings);
  return { company, alex: await addPerson(company) };
}

const newId = () => crypto.randomUUID();

function postCheckIn(token: string, clientRequestId: string = newId(), extra: object = {}) {
  return request(app).post("/api/v1/attendance/check-in").set("Authorization", token).send({ clientRequestId, ...extra });
}
function postCheckOut(token: string) {
  return request(app).post("/api/v1/attendance/check-out").set("Authorization", token).send({});
}
function getToday(token: string) {
  return request(app).get("/api/v1/attendance/me/today").set("Authorization", token);
}

function rowsFor(person: Person) {
  return platformPrisma.attendanceRecord.findMany({ where: { employeeId: person.employeeId! }, orderBy: { workDate: "asc" } });
}

async function checkInAt(person: Person, when: Date) {
  const res = await postCheckIn(await at(person, when));
  expect(res.status).toBe(201);
  return res.body.record;
}

/** A row the way the day close job (step 2.7) will write it. */
function systemRow(company: { id: string }, person: Person, workDate: string, status: "ABSENT" | "ON_LEAVE" | "HOLIDAY") {
  return platformPrisma.attendanceRecord.create({
    data: { companyId: company.id, employeeId: person.employeeId!, workDate: new Date(workDate), status, source: "SYSTEM" },
  });
}

describe("attendance module", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(colombo("03", "08:00:00"));
    tokens.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("access", () => {
    const ENDPOINTS = [
      ["GET", "/attendance/me/today"],
      ["GET", "/attendance/me"],
      ["POST", "/attendance/check-in"],
      ["POST", "/attendance/check-out"],
      ["GET", "/attendance/some-id"],
    ] as const;

    function call(method: "GET" | "POST", path: string, token?: string) {
      const req = method === "GET" ? request(app).get(`/api/v1${path}`) : request(app).post(`/api/v1${path}`);
      if (token) req.set("Authorization", token);
      return method === "POST" ? req.send({ clientRequestId: newId() }) : req;
    }

    it.each(ENDPOINTS)("%s %s answers MODULE_DISABLED when attendance is off", async (method, path) => {
      const company = await setUpCompany({}, { sites: true });
      const alex = await addPerson(company);

      const res = await call(method, path, await at(alex, new Date()));

      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({ code: "MODULE_DISABLED", details: { module: "attendance" } });
      expect(await platformPrisma.attendanceRecord.count()).toBe(0);
    });

    it.each(ENDPOINTS)("%s %s needs a login", async (method, path) => {
      const res = await call(method, path);
      expect(res.status).toBe(401);
    });

    it.each(ENDPOINTS)("%s %s is closed to SUPER_ADMIN", async (method, path) => {
      const email = `root-${crypto.randomBytes(3).toString("hex")}@example.test`;
      const { password } = await createTestUser({ companyId: null, role: "SUPER_ADMIN", email });
      const login = await platformLoginAs(app, { email, password, clientType: "mobile" });

      const res = await call(method, path, `Bearer ${login.body.accessToken as string}`);

      expect(res.status).toBe(403);
    });

    it.each(ENDPOINTS.filter(([, path]) => !path.endsWith("some-id")))(
      "%s %s answers NO_EMPLOYEE_PROFILE for an admin with no profile",
      async (method, path) => {
        const company = await setUpCompany();
        const admin = await addPerson(company, "COMPANY_ADMIN", { profile: false });

        const res = await call(method, path, await at(admin, new Date()));

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("NO_EMPLOYEE_PROFILE");
      },
    );

    it.each(["HR", "MANAGER", "COMPANY_ADMIN"] as const)("%s with a profile can check in too", async (role) => {
      const company = await setUpCompany();
      const person = await addPerson(company, role);

      const res = await postCheckIn(await at(person, colombo("03", "09:00:00")));

      expect(res.status).toBe(201);
    });
  });

  // The server's own timezone must never change an answer.
  describe.each(TEST_TIMEZONES)("check-in with server TZ=$tz", ({ tz, offsetMinutes }) => {
    useProcessTimezone(tz, offsetMinutes);

    it.each([
      ["on time", "09:00:00", "PRESENT", 0],
      ["at the end of grace", "09:10:00", "PRESENT", 0],
      ["just after grace", "09:10:01", "LATE", 10],
      ["twelve minutes late", "09:12:00", "LATE", 12],
    ])("%s", async (_label, time, status, lateMinutes) => {
      const { alex } = await setUp();

      const res = await postCheckIn(await at(alex, colombo("03", time)));

      expect(res.status).toBe(201);
      expect(res.body.record).toMatchObject({
        workDate: "2026-11-03",
        status,
        lateMinutes,
        source: "MOBILE",
        checkInAt: colombo("03", time).toISOString(),
        scheduledStartAt: colombo("03", "09:00:00").toISOString(),
        scheduledEndAt: colombo("03", "17:00:00").toISOString(),
      });
      expect(AttendanceRecordWithCoordinatesSchema.strict().safeParse(res.body.record).success).toBe(true);
    });

    it("a check-in just after Colombo's midnight belongs to the new day, while UTC is still on the old one", async () => {
      const { alex } = await setUp();

      const res = await postCheckIn(await at(alex, colombo("04", "00:15:00")));

      expect(res.body.record.workDate).toBe("2026-11-04");
    });

    it("uses the company's own timezone", async () => {
      const company = await createTestCompany();
      await platformPrisma.company.update({ where: { id: company.id }, data: { timezone: "Europe/London" } });
      await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { enabledModules: { attendance: true } } });
      invalidateEnabledModulesCache(company.id);
      const person = await addPerson(company);

      const res = await postCheckIn(await at(person, new Date("2026-11-03T09:30:00.000Z")));

      expect(res.body.record).toMatchObject({ status: "LATE", lateMinutes: 30, scheduledStartAt: "2026-11-03T09:00:00.000Z" });
    });
  });

  describe("check-in rules", () => {
    it("ignores a work date, time, status or location sent by the phone", async () => {
      const { alex } = await setUp();

      const res = await postCheckIn(await at(alex, colombo("03", "09:30:00")), newId(), {
        workDate: "2020-01-01",
        status: "PRESENT",
        checkInAt: "2020-01-01T00:00:00.000Z",
        clientTime: "2020-01-01T00:00:00.000Z",
        location: { latitude: 6.9, longitude: 79.8, accuracy: 5, mocked: false, capturedAt: "2026-11-03T04:00:00.000Z" },
      });

      expect(res.status).toBe(201);
      expect(res.body.record).toMatchObject({ workDate: "2026-11-03", status: "LATE" });
      const [row] = await rowsFor(alex);
      expect(row).toMatchObject({ checkInLat: null, checkInLng: null, checkInAccuracyM: null, checkInMocked: null });
    });

    it("rejects a missing or malformed clientRequestId", async () => {
      const { alex } = await setUp();
      const token = await at(alex, colombo("03", "09:00:00"));

      expect((await request(app).post("/api/v1/attendance/check-in").set("Authorization", token).send({})).status).toBe(400);
      expect((await postCheckIn(token, "nope")).status).toBe(400);
    });

    it("an early bird's check-in belongs to today, and is on time", async () => {
      const { alex } = await setUp();

      const res = await postCheckIn(await at(alex, colombo("03", "03:00:00")));

      expect(res.body.record).toMatchObject({ workDate: "2026-11-03", status: "PRESENT" });
    });

    it("a weekly off day has no schedule, is never late, and is flagged", async () => {
      const { alex } = await setUp();

      const record = await checkInAt(alex, colombo("08", "15:00:00"));

      expect(record).toMatchObject({
        status: "PRESENT",
        lateMinutes: 0,
        flags: ["NON_WORKING_DAY"],
        scheduledStartAt: null,
        scheduledEndAt: null,
      });
    });

    it("a Saturday half day is a working day that ends at the half-day time", async () => {
      const { alex } = await setUp();

      const record = await checkInAt(alex, colombo("07", "09:00:00"));

      expect(record.scheduledEndAt).toBe(colombo("07", "13:00:00").toISOString());
      expect(record.flags).toEqual([]);
    });

    it("a company holiday is a non-working day", async () => {
      const { company, alex } = await setUp();
      await platformPrisma.companyHoliday.create({ data: { companyId: company.id, date: new Date("2026-11-03"), name: "Poya" } });

      const record = await checkInAt(alex, colombo("03", "15:00:00"));

      expect(record).toMatchObject({ status: "PRESENT", flags: ["NON_WORKING_DAY"], scheduledStartAt: null });
    });

    async function approvedLeave(company: { id: string }, person: Person, extra: object = {}) {
      const leaveType = await platformPrisma.leaveType.findFirstOrThrow({ where: { companyId: company.id } });
      return platformPrisma.leaveRequest.create({
        data: {
          companyId: company.id,
          employeeId: person.employeeId!,
          leaveTypeId: leaveType.id,
          startDate: new Date("2026-11-03"),
          endDate: new Date("2026-11-03"),
          totalDays: 1,
          status: "APPROVED",
          ...extra,
        },
      });
    }

    it("a full day's approved leave allows the check-in and flags it, and leaves the leave alone", async () => {
      const { company, alex } = await setUp();
      const leave = await approvedLeave(company, alex);

      const record = await checkInAt(alex, colombo("03", "09:30:00"));

      expect(record).toMatchObject({ status: "LATE", lateMinutes: 30, flags: ["ON_APPROVED_LEAVE"] });
      expect((await platformPrisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } })).status).toBe("APPROVED");
    });

    it("half a day's approved leave isn't judged for lateness or leaving early", async () => {
      const { company, alex } = await setUp();
      await approvedLeave(company, alex, { startHalfDay: true, totalDays: 0.5 });

      const record = await checkInAt(alex, colombo("03", "13:30:00"));
      expect(record).toMatchObject({ status: "PRESENT", lateMinutes: 0, flags: ["HALF_DAY_LEAVE"] });

      const out = await postCheckOut(await at(alex, colombo("03", "15:00:00")));
      expect(out.body.record.earlyLeaveMinutes).toBe(0);
    });

    it("leave that isn't approved doesn't count", async () => {
      const { company, alex } = await setUp();
      await approvedLeave(company, alex, { status: "PENDING_MANAGER" });

      expect((await checkInAt(alex, colombo("03", "09:00:00"))).flags).toEqual([]);
    });

    it("another employee's leave doesn't count", async () => {
      const { company, alex } = await setUp();
      const sam = await addPerson(company);
      await approvedLeave(company, sam);

      expect((await checkInAt(alex, colombo("03", "09:00:00"))).flags).toEqual([]);
    });

    it("is refused after the day's close time", async () => {
      const { alex } = await setUp();

      const res = await postCheckIn(await at(alex, colombo("03", "21:00:00")));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("DAY_ALREADY_CLOSED");
      expect(await rowsFor(alex)).toHaveLength(0);
    });

    it.each(["ABSENT", "ON_LEAVE", "HOLIDAY"] as const)("is refused on a row day close wrote as %s, and doesn't change it", async (status) => {
      const { company, alex } = await setUp();
      await systemRow(company, alex, "2026-11-03", status);
      const token = await at(alex, colombo("03", "10:00:00"));

      const res = await postCheckIn(token);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("DAY_ALREADY_CLOSED");
      expect((await rowsFor(alex))[0]).toMatchObject({ status, checkInAt: null });
      expect((await getToday(token)).body.nextAction).toBe("DAY_CLOSED");
    });

    it("doesn't let yesterday's forgotten check-out block today", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));

      const res = await postCheckIn(await at(alex, colombo("04", "09:00:00")));

      expect(res.status).toBe(201);
      expect(res.body.record.workDate).toBe("2026-11-04");
      expect(await rowsFor(alex)).toHaveLength(2);
    });
  });

  describe("double check-ins and retries", () => {
    it("a second check-in with a new id is 409, with the existing record", async () => {
      const { alex } = await setUp();
      const first = await checkInAt(alex, colombo("03", "09:00:00"));

      const res = await postCheckIn(await at(alex, colombo("03", "09:01:00")));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ALREADY_CHECKED_IN");
      expect(res.body.error.details.record.id).toBe(first.id);
      expect(await rowsFor(alex)).toHaveLength(1);
    });

    it("a retry with the same id is 200, with the same record and the original time", async () => {
      const { alex } = await setUp();
      const id = newId();
      const first = await postCheckIn(await at(alex, colombo("03", "09:00:00")), id);

      const retry = await postCheckIn(await at(alex, colombo("03", "09:05:00")), id);

      expect(retry.status).toBe(200);
      expect(retry.body.record).toEqual(first.body.record);
      expect(await rowsFor(alex)).toHaveLength(1);
    });

    it("a retry still finds its record after check-out", async () => {
      const { alex } = await setUp();
      const id = newId();
      await postCheckIn(await at(alex, colombo("03", "09:00:00")), id);
      await postCheckOut(await at(alex, colombo("03", "17:00:00")));

      const retry = await postCheckIn(await at(alex, colombo("03", "17:01:00")), id);

      expect(retry.status).toBe(200);
      expect(retry.body.record.checkOutAt).not.toBeNull();
    });

    it("a retry still finds its record after the work date has moved on", async () => {
      const { alex } = await setUp({ workStartTime: "22:00", workEndTime: "06:00" });
      const id = newId();
      await postCheckIn(await at(alex, colombo("04", "05:59:00")), id);

      const retry = await postCheckIn(await at(alex, colombo("04", "06:01:00")), id);

      expect(retry.status).toBe(200);
      expect(retry.body.record.workDate).toBe("2026-11-03");
      expect(await rowsFor(alex)).toHaveLength(1);
    });

    it("two employees can use the same id without touching each other's records", async () => {
      const { company, alex } = await setUp();
      const sam = await addPerson(company);
      const id = newId();

      const first = await postCheckIn(await at(alex, colombo("03", "09:00:00")), id);
      const second = await postCheckIn(await at(sam, colombo("03", "09:00:00")), id);

      expect(second.status).toBe(201);
      expect(second.body.record.id).not.toBe(first.body.record.id);
    });

    it("two simultaneous check-ins with different ids make one row", async () => {
      const { alex } = await setUp();
      const token = await at(alex, colombo("03", "09:00:00"));

      const results = await Promise.all([postCheckIn(token), postCheckIn(token), postCheckIn(token), postCheckIn(token)]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
      for (const res of results.filter((r) => r.status === 409)) {
        expect(res.body.error.code).toBe("ALREADY_CHECKED_IN");
      }
      expect(await rowsFor(alex)).toHaveLength(1);
    });

    it("two simultaneous requests with the same id make one row, and both succeed", async () => {
      const { alex } = await setUp();
      const token = await at(alex, colombo("03", "09:00:00"));
      const id = newId();

      const results = await Promise.all([postCheckIn(token, id), postCheckIn(token, id)]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(results[0]!.body.record.id).toBe(results[1]!.body.record.id);
      expect(await rowsFor(alex)).toHaveLength(1);
    });
  });

  describe("check-out", () => {
    it("records worked and early-leave minutes, and keeps the status", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:12:00"));

      const res = await postCheckOut(await at(alex, colombo("03", "16:30:00")));

      expect(res.status).toBe(200);
      expect(res.body.record).toMatchObject({
        status: "LATE",
        lateMinutes: 12,
        workedMinutes: 438,
        earlyLeaveMinutes: 30,
        checkOutAt: colombo("03", "16:30:00").toISOString(),
      });
    });

    it("works with no request body at all", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));
      const token = await at(alex, colombo("03", "17:00:00"));

      const res = await request(app).post("/api/v1/attendance/check-out").set("Authorization", token);

      expect(res.status).toBe(200);
    });

    it("keeps a grace period someone changes mid-shift from rewriting the status", async () => {
      const { company, alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:05:00"));
      await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { lateGraceMinutes: 0 } });

      const res = await postCheckOut(await at(alex, colombo("03", "17:00:00")));

      expect(res.body.record.status).toBe("PRESENT");
    });

    it("judges against the schedule snapshot if the hours change mid-shift", async () => {
      const { company, alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));
      await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { workEndTime: "18:00" } });

      const res = await postCheckOut(await at(alex, colombo("03", "17:00:00")));

      expect(res.body.record.earlyLeaveMinutes).toBe(0);
    });

    it("a check-out with no check-in is NOT_CHECKED_IN, and writes nothing", async () => {
      const { alex } = await setUp();

      const res = await postCheckOut(await at(alex, colombo("03", "17:00:00")));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("NOT_CHECKED_IN");
      expect(await rowsFor(alex)).toHaveLength(0);
    });

    it("a second check-out is ALREADY_CHECKED_OUT and doesn't move the time", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));
      await postCheckOut(await at(alex, colombo("03", "17:00:00")));

      const res = await postCheckOut(await at(alex, colombo("03", "17:05:00")));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ALREADY_CHECKED_OUT");
      expect((await rowsFor(alex))[0]!.checkOutAt).toEqual(colombo("03", "17:00:00"));
    });

    it("a check-in after check-out is ALREADY_CHECKED_OUT", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));
      await postCheckOut(await at(alex, colombo("03", "12:00:00")));

      const res = await postCheckIn(await at(alex, colombo("03", "13:00:00")));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ALREADY_CHECKED_OUT");
    });

    it("two simultaneous check-outs write once: one succeeds, one is told it's done", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));
      const token = await at(alex, colombo("03", "17:00:00"));

      const results = await Promise.all([postCheckOut(token), postCheckOut(token)]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it("a check-out in the same instant as the check-in doesn't break the database rule", async () => {
      const { alex } = await setUp();
      const when = colombo("03", "09:00:00");
      await checkInAt(alex, when);

      const res = await postCheckOut(await at(alex, when));

      expect(res.status).toBe(200);
      expect(res.body.record.workedMinutes).toBe(0);
    });

    it("is refused from the close time on, and the record is left as it was", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));

      const ok = await getToday(await at(alex, colombo("03", "20:59:59")));
      expect(ok.body.nextAction).toBe("CHECK_OUT");

      const res = await postCheckOut(await at(alex, colombo("03", "21:00:00")));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("DAY_ALREADY_CLOSED");
      expect((await rowsFor(alex))[0]).toMatchObject({ checkOutAt: null, workedMinutes: null });
    });

    it("is refused on an auto-closed record", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));
      await platformPrisma.attendanceRecord.updateMany({
        where: { employeeId: alex.employeeId! },
        data: { status: "INCOMPLETE", autoClosedAt: colombo("03", "17:30:00"), flags: ["AUTO_CLOSED"] },
      });

      const res = await postCheckOut(await at(alex, colombo("03", "18:00:00")));

      expect(res.body.error.code).toBe("DAY_ALREADY_CLOSED");
    });

    it("the next day, a check-out for yesterday's forgotten record says the day closed", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));

      const res = await postCheckOut(await at(alex, colombo("04", "08:00:00")));

      expect(res.body.error.code).toBe("DAY_ALREADY_CLOSED");
    });

    it("a week later, a check-out with an old forgotten record says you haven't checked in", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));

      const res = await postCheckOut(await at(alex, colombo("10", "08:00:00")));

      expect(res.body.error.code).toBe("NOT_CHECKED_IN");
    });

    it("on a row day close wrote, says you haven't checked in", async () => {
      const { company, alex } = await setUp();
      await systemRow(company, alex, "2026-11-03", "ABSENT");

      const res = await postCheckOut(await at(alex, colombo("03", "10:00:00")));

      expect(res.body.error.code).toBe("NOT_CHECKED_IN");
    });

    it("flags a shift over 16 hours", async () => {
      const { alex } = await setUp({ autoCheckoutAfterMinutes: 720 });
      await checkInAt(alex, colombo("03", "07:00:00"));

      const res = await postCheckOut(await at(alex, colombo("04", "00:00:00")));

      expect(res.body.record.workedMinutes).toBe(1020);
      expect(res.body.record.flags).toEqual(["LONG_SHIFT"]);
    });

    it("a check-in on a day off stays open for 16 hours, then is closed", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("08", "10:00:00"));

      expect((await getToday(await at(alex, colombo("09", "01:59:00")))).body.nextAction).toBe("CHECK_OUT");

      const closed = await postCheckOut(await at(alex, colombo("09", "02:00:00")));
      expect(closed.body.error.code).toBe("DAY_ALREADY_CLOSED");
    });
  });

  describe("night shift", () => {
    const NIGHT = { workStartTime: "22:00", workEndTime: "06:00" };

    it("a check-in before and after midnight both belong to the shift's first day", async () => {
      const { alex } = await setUp(NIGHT);
      expect((await checkInAt(alex, colombo("03", "21:55:00"))).workDate).toBe("2026-11-03");

      const { alex: sam } = await setUp(NIGHT);
      const late = await checkInAt(sam, colombo("04", "00:20:00"));
      expect(late).toMatchObject({ workDate: "2026-11-03", status: "LATE", lateMinutes: 140 });
    });

    it("checking out on time closes the night's record", async () => {
      const { alex } = await setUp(NIGHT);
      await checkInAt(alex, colombo("03", "22:00:00"));

      const res = await postCheckOut(await at(alex, colombo("04", "06:00:00")));

      expect(res.status).toBe(200);
      expect(res.body.record).toMatchObject({ workDate: "2026-11-03", workedMinutes: 480, earlyLeaveMinutes: 0 });
    });

    it("checking out after the shift's end still finds the night's record", async () => {
      const { alex } = await setUp(NIGHT);
      await checkInAt(alex, colombo("03", "22:00:00"));
      const token = await at(alex, colombo("04", "06:30:00"));

      const today = await getToday(token);
      expect(today.body).toMatchObject({ workDate: "2026-11-03", nextAction: "CHECK_OUT" });
      expect(today.body.record.workDate).toBe("2026-11-03");

      const res = await postCheckOut(token);
      expect(res.status).toBe(200);
      expect(res.body.record).toMatchObject({ workDate: "2026-11-03", workedMinutes: 510 });
      expect(await rowsFor(alex)).toHaveLength(1);
    });

    it("after a late check-out the card says done, not check in, until the close time", async () => {
      const { alex } = await setUp(NIGHT);
      await checkInAt(alex, colombo("03", "22:00:00"));
      await postCheckOut(await at(alex, colombo("04", "06:30:00")));

      expect((await getToday(await at(alex, colombo("04", "06:31:00")))).body.nextAction).toBe("DONE");
      const again = await postCheckOut(await at(alex, colombo("04", "06:32:00")));
      expect(again.body.error.code).toBe("ALREADY_CHECKED_OUT");

      const evening = await getToday(await at(alex, colombo("04", "21:30:00")));
      expect(evening.body).toMatchObject({ workDate: "2026-11-04", nextAction: "CHECK_IN", record: null });
    });

    it("a check-in during the night's check-out window doesn't start a second record", async () => {
      const { alex } = await setUp(NIGHT);
      await checkInAt(alex, colombo("03", "22:00:00"));

      const res = await postCheckIn(await at(alex, colombo("04", "06:30:00")));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ALREADY_CHECKED_IN");
      expect(await rowsFor(alex)).toHaveLength(1);
    });

    it("after the close time, check-out says the day closed", async () => {
      const { alex } = await setUp(NIGHT);
      await checkInAt(alex, colombo("03", "22:00:00"));

      const res = await postCheckOut(await at(alex, colombo("04", "10:00:00")));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("DAY_ALREADY_CLOSED");
    });

    it("the early hours after a day off don't belong to a shift from that day off", async () => {
      const { alex } = await setUp(NIGHT);
      // Sunday is off, so 00:20 on Monday can't belong to a shift from Sunday.
      const record = await checkInAt(alex, colombo("09", "00:20:00"));

      expect(record).toMatchObject({ workDate: "2026-11-09", status: "PRESENT" });
    });

    it("a day-shift worker staying past midnight checks out of the day they started", async () => {
      const { alex } = await setUp({ autoCheckoutAfterMinutes: 720 });
      await checkInAt(alex, colombo("03", "09:00:00"));

      const res = await postCheckOut(await at(alex, colombo("04", "00:30:00")));

      expect(res.status).toBe(200);
      expect(res.body.record).toMatchObject({ workDate: "2026-11-03", workedMinutes: 930 });
    });
  });

  describe("GET /attendance/me/today", () => {
    it("before check-in: the schedule, no record, offer check in", async () => {
      const { alex } = await setUp();

      const res = await getToday(await at(alex, colombo("03", "08:00:00")));

      expect(res.status).toBe(200);
      expect(AttendanceTodaySchema.strict().safeParse(res.body).success).toBe(true);
      expect(res.body).toEqual({
        workDate: "2026-11-03",
        schedule: {
          dayType: "WORKING",
          isHalfDayLeave: false,
          scheduledStartAt: colombo("03", "09:00:00").toISOString(),
          scheduledEndAt: colombo("03", "17:00:00").toISOString(),
          lateGraceMinutes: 10,
        },
        record: null,
        nextAction: "CHECK_IN",
      });
    });

    it("follows the day through check-in and check-out", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));
      const afterIn = await getToday(await at(alex, colombo("03", "09:01:00")));
      expect(afterIn.body.nextAction).toBe("CHECK_OUT");

      await postCheckOut(await at(alex, colombo("03", "17:00:00")));
      const afterOut = await getToday(await at(alex, colombo("03", "17:01:00")));
      expect(afterOut.body.nextAction).toBe("DONE");
      expect(afterOut.body.record.workedMinutes).toBe(480);
    });

    it("after the close time with no check-in, offers nothing", async () => {
      const { alex } = await setUp();

      expect((await getToday(await at(alex, colombo("03", "21:00:00")))).body.nextAction).toBe("DAY_CLOSED");
    });

    it("the next morning, offers a new check-in", async () => {
      const { alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));

      const res = await getToday(await at(alex, colombo("04", "08:00:00")));

      expect(res.body).toMatchObject({ workDate: "2026-11-04", record: null, nextAction: "CHECK_IN" });
    });

    it("shows a weekly off day", async () => {
      const { alex } = await setUp();

      const res = await getToday(await at(alex, colombo("08", "10:00:00")));

      expect(res.body.schedule).toMatchObject({ dayType: "OFF", scheduledStartAt: null });
      expect(res.body.nextAction).toBe("CHECK_IN");
    });

    it("keeps showing the schedule the record was judged against", async () => {
      const { company, alex } = await setUp();
      await checkInAt(alex, colombo("03", "09:00:00"));
      await platformPrisma.companySettings.update({ where: { companyId: company.id }, data: { workStartTime: "10:00" } });

      const res = await getToday(await at(alex, colombo("03", "09:30:00")));

      expect(res.body.schedule.scheduledStartAt).toBe(colombo("03", "09:00:00").toISOString());
    });
  });

  describe("GET /attendance/me", () => {
    async function threeDays(alex: Person) {
      await checkInAt(alex, colombo("02", "09:00:00"));
      await checkInAt(alex, colombo("03", "09:00:00"));
      await checkInAt(alex, colombo("04", "09:00:00"));
    }
    const list = (token: string, query = "") => request(app).get(`/api/v1/attendance/me${query}`).set("Authorization", token);

    it("lists my records, newest first, paginated", async () => {
      const { alex } = await setUp();
      await threeDays(alex);

      const res = await list(await at(alex, colombo("04", "10:00:00")), "?page=2&pageSize=2");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
      expect(res.body.data.map((r: { workDate: string }) => r.workDate)).toEqual(["2026-11-02"]);
    });

    it("filters by date, inclusive at both ends", async () => {
      const { alex } = await setUp();
      await threeDays(alex);

      const res = await list(await at(alex, colombo("04", "10:00:00")), "?from=2026-11-02&to=2026-11-03");

      expect(res.body.data.map((r: { workDate: string }) => r.workDate)).toEqual(["2026-11-03", "2026-11-02"]);
    });

    it("rejects a range over 93 days and a page size over 100", async () => {
      const { alex } = await setUp();
      const token = await at(alex, colombo("03", "10:00:00"));

      expect((await list(token, "?from=2026-01-01&to=2026-04-05")).status).toBe(400);
      expect((await list(token, "?pageSize=101")).status).toBe(400);
    });

    it("never includes anyone else's records", async () => {
      const { company, alex } = await setUp();
      const sam = await addPerson(company);
      await checkInAt(sam, colombo("03", "09:00:00"));

      const res = await list(await at(alex, colombo("03", "10:00:00")));

      expect(res.body.total).toBe(0);
    });

    it("includes my own coordinates", async () => {
      const { alex } = await setUp();
      const record = await checkInAt(alex, colombo("03", "09:00:00"));
      await platformPrisma.attendanceRecord.update({ where: { id: record.id }, data: { checkInLat: 6.927079, checkInLng: 79.861244 } });

      const res = await list(await at(alex, colombo("03", "10:00:00")));

      expect(res.body.data[0]).toMatchObject({ checkInLat: 6.927079, checkInLng: 79.861244 });
    });
  });

  describe("GET /attendance/:id", () => {
    /** Alex reports to Morgan. Alex has a record with a stored position. */
    async function team() {
      const company = await setUpCompany();
      const morgan = await addPerson(company, "MANAGER");
      const alex = await addPerson(company);
      await platformPrisma.employee.update({ where: { id: alex.employeeId! }, data: { managerId: morgan.employeeId! } });
      const record = await checkInAt(alex, colombo("03", "09:00:00"));
      await platformPrisma.attendanceRecord.update({ where: { id: record.id }, data: { checkInLat: 6.927079, checkInLng: 79.861244 } });
      return { company, morgan, alex, id: record.id as string };
    }
    const get = (token: string, id: string) => request(app).get(`/api/v1/attendance/${id}`).set("Authorization", token);

    it("the owner gets it, with coordinates", async () => {
      const { alex, id } = await team();

      const res = await get(await at(alex, colombo("03", "10:00:00")), id);

      expect(res.status).toBe(200);
      expect(AttendanceRecordWithCoordinatesSchema.strict().safeParse(res.body.record).success).toBe(true);
      expect(res.body.record.checkInLat).toBe(6.927079);
    });

    it.each(["HR", "COMPANY_ADMIN"] as const)("%s gets it, with coordinates", async (role) => {
      const { company, id } = await team();
      const person = await addPerson(company, role, { profile: role !== "COMPANY_ADMIN" });

      const res = await get(await at(person, colombo("03", "10:00:00")), id);

      expect(res.status).toBe(200);
      expect(res.body.record.checkInLng).toBe(79.861244);
    });

    it("their manager gets it, with no coordinates anywhere in the response", async () => {
      const { morgan, id } = await team();

      const res = await get(await at(morgan, colombo("03", "10:00:00")), id);

      expect(res.status).toBe(200);
      expect(AttendanceRecordSchema.strict().safeParse(res.body.record).success).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/Lat|Lng|6\.927|79\.861/);
    });

    it("another manager gets 404", async () => {
      const { company, id } = await team();
      const other = await addPerson(company, "MANAGER");

      expect((await get(await at(other, colombo("03", "10:00:00")), id)).status).toBe(404);
    });

    it("another employee gets 404", async () => {
      const { company, id } = await team();
      const sam = await addPerson(company);

      expect((await get(await at(sam, colombo("03", "10:00:00")), id)).status).toBe(404);
    });

    it("an EMPLOYEE-role user named as someone's manager gets 404, because the role is what grants it", async () => {
      const company = await setUpCompany();
      const lead = await addPerson(company);
      const alex = await addPerson(company);
      await platformPrisma.employee.update({ where: { id: alex.employeeId! }, data: { managerId: lead.employeeId! } });
      const record = await checkInAt(alex, colombo("03", "09:00:00"));

      expect((await get(await at(lead, colombo("03", "10:00:00")), record.id)).status).toBe(404);
    });

    it("an unknown id gets 404", async () => {
      const { alex } = await team();

      expect((await get(await at(alex, colombo("03", "10:00:00")), crypto.randomUUID())).status).toBe(404);
    });

    it.each(["HR", "COMPANY_ADMIN", "MANAGER", "EMPLOYEE"] as const)("%s in another company gets 404", async (role) => {
      const { id } = await team();
      const otherCompany = await setUpCompany();
      const outsider = await addPerson(otherCompany, role);

      const res = await get(await at(outsider, colombo("03", "10:00:00")), id);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("tenant isolation", () => {
    it("one company's check-in has no effect on another company's employee, even with the same request id", async () => {
      const { alex } = await setUp();
      const { alex: bea } = await setUp();
      const id = newId();
      await postCheckIn(await at(alex, colombo("03", "09:00:00")), id);

      const res = await postCheckIn(await at(bea, colombo("03", "09:05:00")), id);

      expect(res.status).toBe(201);
      expect(res.body.record.employeeId).toBe(bea.employeeId);
      expect(await rowsFor(alex)).toHaveLength(1);
      expect(await rowsFor(bea)).toHaveLength(1);
    });

    it("uses the caller's own company's settings and holidays", async () => {
      const { alex } = await setUp({ workStartTime: "10:00", workEndTime: "18:00" });
      const { company: beta, alex: bea } = await setUp();
      await platformPrisma.companyHoliday.create({ data: { companyId: beta.id, date: new Date("2026-11-03"), name: "Beta day" } });

      const res = await getToday(await at(alex, colombo("03", "09:00:00")));

      expect(res.body.schedule).toMatchObject({ dayType: "WORKING", scheduledStartAt: colombo("03", "10:00:00").toISOString() });
      expect((await getToday(await at(bea, colombo("03", "09:00:00")))).body.schedule.dayType).toBe("HOLIDAY");
    });

    it("a company's module switch only affects that company", async () => {
      const { alex } = await setUp();
      const off = await setUpCompany({}, {});
      const bea = await addPerson(off);

      expect((await getToday(await at(alex, colombo("03", "09:00:00")))).status).toBe(200);
      expect((await getToday(await at(bea, colombo("03", "09:00:00")))).status).toBe(403);
    });
  });

  describe("database rules", () => {
    async function aRecord() {
      const { company, alex } = await setUp();
      return { company, alex, record: await checkInAt(alex, colombo("03", "09:00:00")) };
    }

    it("refuses a second row for the same employee and date", async () => {
      const { company, alex } = await aRecord();

      await expect(systemRow(company, alex, "2026-11-03", "ABSENT")).rejects.toThrow();
    });

    it("refuses a check-out before the check-in", async () => {
      const { record } = await aRecord();

      await expect(
        platformPrisma.attendanceRecord.update({ where: { id: record.id }, data: { checkOutAt: colombo("03", "08:00:00") } }),
      ).rejects.toThrow();
    });

    it("refuses a check-out with no check-in", async () => {
      const { company, alex } = await setUp();

      await expect(
        platformPrisma.attendanceRecord.create({
          data: { companyId: company.id, employeeId: alex.employeeId!, workDate: new Date("2026-11-03"), status: "ABSENT", source: "SYSTEM", checkOutAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    it("refuses PRESENT with no check-in", async () => {
      const { company, alex } = await setUp();

      await expect(
        platformPrisma.attendanceRecord.create({
          data: { companyId: company.id, employeeId: alex.employeeId!, workDate: new Date("2026-11-03"), status: "PRESENT", source: "SYSTEM" },
        }),
      ).rejects.toThrow();
    });

    it("a site attendance points at can't be deleted: 409 SITE_IN_USE", async () => {
      const company = await setUpCompany({}, { attendance: true, sites: true });
      const hr = await addPerson(company, "HR");
      const alex = await addPerson(company);
      const hrToken = await at(hr, colombo("03", "09:00:00"));
      const site = await request(app).post("/api/v1/sites").set("Authorization", hrToken).send({ name: "Head Office", type: "OFFICE" });
      const record = await checkInAt(alex, colombo("03", "09:00:00"));
      await platformPrisma.attendanceRecord.update({ where: { id: record.id }, data: { checkInSiteId: site.body.site.id } });

      const res = await request(app).delete(`/api/v1/sites/${site.body.site.id as string}`).set("Authorization", hrToken);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SITE_IN_USE");
    });
  });

  it("writes no audit row for a plain check-in or check-out", async () => {
    const { company, alex } = await setUp();
    await checkInAt(alex, colombo("03", "09:00:00"));
    await postCheckOut(await at(alex, colombo("03", "17:00:00")));

    // Logging in is audited, so look for anything about attendance.
    expect(await platformPrisma.auditLog.count({ where: { companyId: company.id, action: { contains: "ATTENDANCE" } } })).toBe(0);
    expect(await platformPrisma.auditLog.count({ where: { companyId: company.id, entityType: "AttendanceRecord" } })).toBe(0);
  });
});
