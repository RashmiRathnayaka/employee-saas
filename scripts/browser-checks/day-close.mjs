/**
 * Step 2.7, for real: the actual worker process, real HTTP, and real pages in Chromium, on
 * the test database. Times are moved by editing rows, since the worker uses the real clock.
 *
 *   node scripts/browser-check.mjs start --reset --seed
 *   node scripts/browser-check.mjs run scripts/browser-checks/day-close.mjs
 *   node scripts/browser-check.mjs stop
 *
 * Run it with a fresh --reset --seed each time. It logs in six times, under the limit of
 * ten in 15 minutes. It assumes a company-time clock after 06:00, so that yesterday's close
 * time (with the 12-hour auto-checkout it sets) has passed and today's hasn't.
 */
import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "api");
const isWindows = process.platform === "win32";
const TIMEZONE = "Asia/Colombo";

/** Always the test database: the name is written here, not read from anywhere. */
function sql(statement) {
  return execFileSync("docker", ["exec", "employee-saas-postgres-1", "psql", "-U", "employee_saas", "-d", "employee_saas_test", "-Atc", statement], {
    encoding: "utf8",
  }).trim();
}

const workerArgs = ["exec", "dotenv", "-e", ".env.test", "--", "tsx", "src/worker.ts", "--once"];
const runWorker = () => execFileAsync("pnpm", workerArgs, { cwd: apiRoot, shell: isWindows });

function isoDate(daysAgo) {
  const now = new Date(Date.now() - daysAgo * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(now);
}

/** The latest date before today that isn't a Sunday, the seed's weekly off day. */
function lastWorkingDate(skip = 0) {
  const dates = [1, 2, 3, 4].map(isoDate).filter((date) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 0);
  return dates[skip];
}

function expectEqual(actual, expected) {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export default async function dayClose({ newPage, login, check, apiUrl }) {
  const api = `${apiUrl}/api/v1`;
  const yesterday = lastWorkingDate();
  const dayBefore = lastWorkingDate(1);

  const mobileLogin = async (identifier) => {
    const res = await fetch(`${api}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client": "mobile" },
      body: JSON.stringify({ companyCode: "ACME", identifier, password: "Passw0rd!" }),
    });
    const body = await res.json();
    if (!body.accessToken) throw new Error(`Couldn't log in as ${identifier}: ${res.status}`);
    return body.accessToken;
  };
  const call = async (token, method, route, body) => {
    const res = await fetch(`${api}${route}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Client": "mobile" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const company = sql(`SELECT id FROM companies WHERE code = 'ACME'`);
  const employeeIdOf = (email) => sql(`SELECT "employeeId" FROM users WHERE email = '${email}'`);
  const statusOn = (email, date) =>
    sql(`SELECT status FROM attendance_records WHERE "employeeId" = '${employeeIdOf(email)}' AND "workDate" = '${date}'`);

  // Attendance has been on for a while, and today's close time can't arrive mid-check.
  sql(`UPDATE company_settings SET "attendanceEnabledAt" = now() - interval '10 days', "autoCheckoutAfterMinutes" = 720 WHERE "companyId" = '${company}'`);

  const hrToken = await mobileLogin("hr@acme.test");
  const alexToken = await mobileLogin("alex@acme.test");
  const taylorToken = await mobileLogin("taylor@acme.test");
  const managerToken = await mobileLogin("manager@acme.test");

  console.log("\nThe worker's first tick");
  await check("/health says no worker has run yet", async () => {
    const health = await (await fetch(`${api}/health`)).json();
    expectEqual(health.worker.ok, false);
    expectEqual(health.worker.lastTickAt, null);
  });

  const site = await call(hrToken, "POST", "/sites", { name: "Check Site", type: "EXTERNAL", gpsRequired: false, radiusMeters: 200 });
  await check("HR can create a site over HTTP", () => expectEqual(site.status, 201));
  const siteId = site.body.site.id;

  const checkIn = await call(alexToken, "POST", "/attendance/check-in", { clientRequestId: crypto.randomUUID() });
  await check("Alex checks in over real HTTP", () => expectEqual(checkIn.status, 201));
  const alexRecord = checkIn.body.record.id;

  // Alex forgot: the shift ended long enough ago that the close time has passed.
  sql(`UPDATE attendance_records SET "scheduledEndAt" = now() - interval '13 hours' WHERE id = '${alexRecord}'`);
  // Jordan visited a site yesterday past the close time, before any row existed.
  sql(`INSERT INTO site_visits (id, "companyId", "employeeId", "siteId", "workDate", status, "checkInAt", "checkOutAt", "durationMinutes", flags, "clientRequestId", "updatedAt")
       VALUES (gen_random_uuid()::text, '${company}', '${employeeIdOf("jordan@acme.test")}', '${siteId}', '${yesterday}', 'CLOSED', now() - interval '20 hours', now() - interval '19 hours', 60, '{AFTER_HOURS}', gen_random_uuid()::text, now())`);

  await runWorker();

  await check("/health now shows the worker's tick", async () => {
    const health = await (await fetch(`${api}/health`)).json();
    expectEqual(health.worker.ok, true);
    if (!health.worker.lastTickAt) throw new Error("no lastTickAt");
  });
  await check("no job failed", () => expectEqual(sql(`SELECT count(*) FROM job_runs WHERE status <> 'DONE'`), "0"));

  console.log("\nAuto-close");
  await check("Alex's record is INCOMPLETE, flagged AUTO_CLOSED", () => {
    // NO_OFFICE_SITE too: the seed has no office, and a check-in's flags stay.
    expectEqual(sql(`SELECT status || ' ' || array_to_string(flags, ',') FROM attendance_records WHERE id = '${alexRecord}'`), "INCOMPLETE NO_OFFICE_SITE,AUTO_CLOSED");
  });
  await check("the Home card's API says the day has closed", async () => {
    const today = await call(alexToken, "GET", "/attendance/me/today");
    expectEqual(today.body.nextAction, "DAY_CLOSED");
  });
  await check("a check-out now answers DAY_ALREADY_CLOSED", async () => {
    const res = await call(alexToken, "POST", "/attendance/check-out", {});
    expectEqual(res.body.error.code, "DAY_ALREADY_CLOSED");
  });

  const alexPage = await newPage();
  await login(alexPage, "alex@acme.test");
  await check("Alex's notifications page says so, and opens the record", async () => {
    await alexPage.goto("/notifications");
    await alexPage.getByText("You didn't check out").first().click();
    await alexPage.waitForURL(`**/attendance/${alexRecord}`);
    await alexPage.getByText("INCOMPLETE", { exact: true }).first().waitFor();
    await alexPage.getByText("Closed automatically").first().waitFor();
  });

  console.log("\nAbsent marking");
  await check(`yesterday (${yesterday}): no-shows are ABSENT`, () => {
    for (const email of ["alex@acme.test", "taylor@acme.test", "jordan@acme.test", "hr@acme.test"]) expectEqual(statusOn(email, yesterday), "ABSENT");
  });
  await check("today isn't marked: its close time hasn't come", () => expectEqual(statusOn("taylor@acme.test", isoDate(0)), ""));
  await check("the row has a schedule, a system source and no check-in", () => {
    const row = sql(`SELECT source, "checkInAt" IS NULL, "scheduledEndAt" IS NOT NULL FROM attendance_records WHERE "employeeId" = '${employeeIdOf("taylor@acme.test")}' AND "workDate" = '${yesterday}'`);
    expectEqual(row, "SYSTEM|t|t");
  });
  await check("nobody is notified of being absent", () => {
    expectEqual(sql(`SELECT count(*) FROM notifications WHERE type LIKE '%ABSENT%'`), "0");
  });
  await check("the waiting visit is linked and now ON_ABSENT_DAY", () => {
    const visit = sql(`SELECT "attendanceRecordId" IS NOT NULL, array_to_string(flags, ',') FROM site_visits WHERE "employeeId" = '${employeeIdOf("jordan@acme.test")}'`);
    expectEqual(visit, "t|ON_ABSENT_DAY");
  });

  const hrPage = await newPage({ timezoneId: "America/New_York" });
  await login(hrPage, "hr@acme.test");
  const openDay = async (date) => {
    await hrPage.goto("/attendance");
    await hrPage.getByLabel("Date").fill(date);
    await hrPage.locator("tbody tr").first().waitFor();
  };
  /** The status chip in one person's row. StatusBadge shows the raw status in capitals. */
  const rowChip = (page, name, status) => page.locator("tbody tr").filter({ hasText: name }).getByText(status, { exact: true });

  await check("HR's Attendance page shows them, with the contradiction on Jordan's row", async () => {
    await openDay(yesterday);
    await hrPage.locator("tbody tr").filter({ hasText: "Jordan" }).getByText("Has a site visit that day").waitFor();
    await rowChip(hrPage, "Jordan", "ABSENT").waitFor();
    await rowChip(hrPage, "Alex", "ABSENT").waitFor();
    const absentCount = await hrPage.locator("tbody").getByText("ABSENT", { exact: true }).count();
    if (absentCount < 4) throw new Error(`only ${absentCount} ABSENT chips`);
  });

  console.log("\nSick leave filed afterwards");
  const sickTypeId = (await call(hrToken, "GET", "/leave-types")).body.data.find((type) => type.code === "SICK").id;
  const leave = await call(taylorToken, "POST", "/leave-requests", { leaveTypeId: sickTypeId, startDate: yesterday, endDate: yesterday });
  await check("Taylor files sick leave for yesterday", () => expectEqual(leave.status, 201));
  const approval = await call(managerToken, "PATCH", `/leave-requests/${leave.body.leaveRequest.id}/approve`, {});
  await check("the manager approves it", () => expectEqual(approval.status, 200));
  await check("Taylor's row flips to ON_LEAVE in the same request", () => expectEqual(statusOn("taylor@acme.test", yesterday), "ON_LEAVE"));
  await check("HR's page shows it", async () => {
    await openDay(yesterday);
    await rowChip(hrPage, "Taylor", "ON LEAVE").waitFor();
    await rowChip(hrPage, "Alex", "ABSENT").waitFor();
  });

  console.log("\nA holiday added and deleted");
  const holiday = await call(hrToken, "POST", "/company/holidays", { date: yesterday, name: "Check holiday" });
  await check("adding it flips ABSENT rows to HOLIDAY", () => {
    expectEqual(holiday.status, 201);
    expectEqual(statusOn("alex@acme.test", yesterday), "HOLIDAY");
    expectEqual(statusOn("taylor@acme.test", yesterday), "HOLIDAY");
  });
  const removed = await call(hrToken, "DELETE", `/company/holidays/${holiday.body.holiday.id}`);
  await check("deleting it flips them back: ABSENT, and ON_LEAVE for Taylor", () => {
    expectEqual(removed.status, 204);
    expectEqual(statusOn("alex@acme.test", yesterday), "ABSENT");
    expectEqual(statusOn("taylor@acme.test", yesterday), "ON_LEAVE");
  });

  console.log("\nTwo real workers at once");
  const taylorCheckIn = await call(taylorToken, "POST", "/attendance/check-in", { clientRequestId: crypto.randomUUID() });
  const taylorRecord = taylorCheckIn.body.record.id;
  sql(`UPDATE attendance_records SET "scheduledEndAt" = now() - interval '13 hours' WHERE id = '${taylorRecord}'`);
  // A forgotten visit, opened 17 hours ago with no attendance row to end with.
  const managerEmployee = employeeIdOf("manager@acme.test");
  sql(`INSERT INTO site_visits (id, "companyId", "employeeId", "siteId", "workDate", status, "checkInAt", "clientRequestId", "updatedAt")
       VALUES (gen_random_uuid()::text, '${company}', '${managerEmployee}', '${siteId}', '${yesterday}', 'OPEN', now() - interval '17 hours', gen_random_uuid()::text, now())`);
  // Make the day before look unfinished, so both workers go after the same claim.
  const activeEmployees = sql(`SELECT count(*) FROM employees WHERE "companyId" = '${company}' AND status = 'ACTIVE'`);
  sql(`DELETE FROM attendance_records WHERE "workDate" = '${dayBefore}' AND "companyId" = '${company}'`);
  sql(`DELETE FROM job_runs WHERE "runKey" = '${dayBefore}' AND "companyId" = '${company}'`);

  await Promise.all([runWorker(), runWorker()]);

  await check("one row per employee for that date", () => {
    expectEqual(sql(`SELECT count(*) FROM attendance_records WHERE "workDate" = '${dayBefore}' AND "companyId" = '${company}'`), activeEmployees);
  });
  await check("one claim, finished first time", () => {
    expectEqual(sql(`SELECT count(*), max(attempts), max(status::text) FROM job_runs WHERE "runKey" = '${dayBefore}' AND "companyId" = '${company}' AND "jobName" = 'attendance.dayClose'`), "1|1|DONE");
  });
  await check("one heartbeat row, however many workers", () => {
    expectEqual(sql(`SELECT count(*) FROM job_runs WHERE "jobName" = 'worker.tick'`), "1");
  });
  await check("Taylor's forgotten day is closed, with one notification", () => {
    expectEqual(sql(`SELECT status FROM attendance_records WHERE id = '${taylorRecord}'`), "INCOMPLETE");
    expectEqual(sql(`SELECT count(*) FROM notifications WHERE type = 'ATTENDANCE_AUTO_CLOSED' AND "relatedEntityId" = '${taylorRecord}'`), "1");
  });
  await check("the forgotten visit is closed by its own rule, with one notification", () => {
    expectEqual(sql(`SELECT status FROM site_visits WHERE "employeeId" = '${managerEmployee}'`), "AUTO_CLOSED");
    expectEqual(sql(`SELECT count(*) FROM notifications WHERE type = 'SITE_VISIT_AUTO_CLOSED'`), "1");
  });
  await check("no job failed", () => expectEqual(sql(`SELECT count(*) FROM job_runs WHERE status <> 'DONE'`), "0"));

  console.log("\nDeactivating someone mid-shift");
  const jordanToken = await mobileLogin("jordan@acme.test");
  const jordanCheckIn = await call(jordanToken, "POST", "/attendance/check-in", { clientRequestId: crypto.randomUUID() });
  const visit = await call(jordanToken, "POST", "/site-visits/check-in", { siteId, clientRequestId: crypto.randomUUID() });
  await check("Jordan is checked in, and on a visit", () => {
    expectEqual(jordanCheckIn.status, 201);
    expectEqual(visit.status, 201);
  });
  const deactivated = await call(hrToken, "PATCH", `/employees/${employeeIdOf("jordan@acme.test")}/status`, { status: "INACTIVE" });
  await check("deactivating closes the record and the visit at once", () => {
    expectEqual(deactivated.status, 200);
    expectEqual(sql(`SELECT status FROM attendance_records WHERE id = '${jordanCheckIn.body.record.id}'`), "INCOMPLETE");
    expectEqual(sql(`SELECT status FROM site_visits WHERE id = '${visit.body.visit.id}'`), "AUTO_CLOSED");
  });

  console.log("\nThe manager's view");
  const managerPage = await newPage();
  await login(managerPage, "manager@acme.test");
  await check("the manager's Attendance page shows the team's flipped day", async () => {
    await managerPage.goto("/attendance");
    await managerPage.getByLabel("Date").fill(yesterday);
    await rowChip(managerPage, "Taylor", "ON LEAVE").waitFor();
    await rowChip(managerPage, "Alex", "ABSENT").waitFor();
  });
}
