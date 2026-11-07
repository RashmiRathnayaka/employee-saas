/**
 * Step 2.8, for real: the actual worker process, real HTTP, and real pages in Chromium, on
 * the test database. Times are moved by editing rows, since the worker uses the real clock.
 *
 *   node scripts/browser-check.mjs start --reset --seed
 *   node scripts/browser-check.mjs run scripts/browser-checks/reminders.mjs
 *   node scripts/browser-check.mjs stop
 *
 * Run it with a fresh --reset --seed each time. It logs in six times, under the limit of
 * ten in 15 minutes. It assumes a company-time clock between 00:10 and 23:50, so that "a
 * few minutes ago" is still today.
 */
import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "api");
const isWindows = process.platform === "win32";
const TIMEZONE = "Asia/Colombo";
const ALL_WEEK = `'{"mon":"FULL","tue":"FULL","wed":"FULL","thu":"FULL","fri":"FULL","sat":"FULL","sun":"FULL"}'`;

/** Always the test database: the name is written here, not read from anywhere. */
function sql(statement) {
  return execFileSync("docker", ["exec", "employee-saas-postgres-1", "psql", "-U", "employee_saas", "-d", "employee_saas_test", "-Atc", statement], {
    encoding: "utf8",
  }).trim();
}

const workerArgs = ["exec", "dotenv", "-e", ".env.test", "--", "tsx", "src/worker.ts", "--once"];
const runWorker = () => execFileAsync("pnpm", workerArgs, { cwd: apiRoot, shell: isWindows });

function localDate(daysFromToday = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(Date.now() + daysFromToday * 86_400_000));
}
function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
/** "HH:mm" in company time, `minutes` from now. */
function localTime(minutes) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(Date.now() + minutes * 60_000),
  );
}

function expectEqual(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export default async function reminders({ newPage, login, check, apiUrl, webUrl }) {
  const api = `${apiUrl}/api/v1`;
  const today = localDate();

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
  const notificationsOf = async (token, type) =>
    (await call(token, "GET", "/notifications?pageSize=100")).body.data.filter((n) => n.type === type);

  const company = sql(`SELECT id FROM companies WHERE code = 'ACME'`);
  const employeeIdOf = (email) => sql(`SELECT "employeeId" FROM users WHERE email = '${email}' AND "companyId" = '${company}'`);
  const giveShiftStartingAt = (email, startTime) =>
    sql(`INSERT INTO employee_schedules (id, "companyId", "employeeId", "startTime", "endTime", "workingDays", "updatedAt")
         VALUES (gen_random_uuid(), '${company}', '${employeeIdOf(email)}', '${startTime}', '${startTime === "23:59" ? "07:59" : "23:59"}', ${ALL_WEEK}, now())
         ON CONFLICT ("companyId", "employeeId") DO UPDATE SET "startTime" = EXCLUDED."startTime", "endTime" = EXCLUDED."endTime", "workingDays" = EXCLUDED."workingDays"`);

  // Nothing about today gets in the way: no holiday, no rows, attendance on for a while.
  sql(`DELETE FROM company_holidays WHERE "companyId" = '${company}' AND date = '${today}'`);
  sql(`DELETE FROM site_visits WHERE "companyId" = '${company}' AND "workDate" = '${today}'`);
  sql(`DELETE FROM attendance_records WHERE "companyId" = '${company}' AND "workDate" = '${today}'`);
  sql(`UPDATE company_settings SET "attendanceEnabledAt" = now() - interval '10 days', "checkinReminderOffsetMinutes" = 0,
       "dailyReminderTime" = '${localTime(-3)}' WHERE "companyId" = '${company}'`);
  // Alex's shift started 3 minutes ago. Taylor's starts in an hour, so day close doesn't mark
  // her ABSENT today before the switch check below moves it.
  giveShiftStartingAt("alex@acme.test", localTime(-3));
  giveShiftStartingAt("taylor@acme.test", localTime(60));

  const [alex, taylor, admin] = [await mobileLogin("alex@acme.test"), await mobileLogin("taylor@acme.test"), await mobileLogin("admin@acme.test")];
  const deadline = Number(sql(`SELECT "sickLeaveProofDeadlineDays" FROM company_settings WHERE "companyId" = '${company}'`));
  const sickTypeId = sql(`SELECT id FROM leave_types WHERE "companyId" = '${company}' AND code = 'SICK'`);

  // Two days each, so a weekly off day can't leave a request with no working day in it.
  const dueTomorrowStart = addDays(addDays(today, 1), -deadline);
  const dueTomorrow = await call(alex, "POST", "/leave-requests", { leaveTypeId: sickTypeId, startDate: dueTomorrowStart, endDate: addDays(dueTomorrowStart, 1), reason: "Flu" });
  await check("Alex files sick leave whose proof is due tomorrow", () => expectEqual([dueTomorrow.status, dueTomorrow.body.leaveRequest?.proofDueAt?.slice(0, 10)], [201, addDays(today, 1)]));

  const overdueStart = addDays(addDays(today, -2), -deadline);
  const overdue = await call(taylor, "POST", "/leave-requests", { leaveTypeId: sickTypeId, startDate: overdueStart, endDate: addDays(overdueStart, 1), reason: "Fever" });
  await check("Taylor files sick leave whose proof was due two days ago", () => expectEqual([overdue.status, overdue.body.leaveRequest?.proofDueAt?.slice(0, 10)], [201, addDays(today, -2)]));

  // GPS: one row past the 90 days, one well inside it. Housekeeping: a claim from 40 days ago.
  const taylorId = employeeIdOf("taylor@acme.test");
  const gpsRow = (daysAgo) =>
    sql(`INSERT INTO attendance_records (id, "companyId", "employeeId", "workDate", status, "checkInAt", "checkOutAt", "checkInLat", "checkInLng", "checkOutLat", "checkOutLng",
           "checkInDistanceM", "checkInWithinRadius", "checkInAccuracyM", source, flags, "updatedAt")
         VALUES (gen_random_uuid(), '${company}', '${taylorId}', current_date - ${daysAgo}, 'PRESENT', now() - interval '${daysAgo} days', now() - interval '${daysAgo} days' + interval '8 hours',
           6.927100, 79.861200, 6.927200, 79.861300, 42, true, 12, 'MOBILE', '{}', now()) RETURNING id`).split("\n")[0];
  const oldGps = gpsRow(100);
  const recentGps = gpsRow(10);
  sql(`INSERT INTO job_runs (id, "companyId", "jobName", "runKey", status, attempts, "startedAt") VALUES (gen_random_uuid(), '${company}', 'attendance.dayClose', 'forty-days-ago', 'DONE', 1, now() - interval '40 days')`);

  // Two real worker processes at once, then a third later.
  await Promise.all([runWorker(), runWorker()]);
  await runWorker();

  await check("no job failed", () => expectEqual(sql(`SELECT count(*) FROM job_runs WHERE status <> 'DONE'`), "0"));
  await check("Alex has one check-in reminder, pointing at nothing", async () => {
    const rows = await notificationsOf(alex, "CHECKIN_REMINDER");
    expectEqual(rows.map((n) => [n.title, n.relatedEntityType]), [["You haven't checked in yet", null]]);
  });
  await check("Alex has one 'due tomorrow' for his request, and nothing overdue", async () => {
    expectEqual((await notificationsOf(alex, "LEAVE_PROOF_DUE_SOON")).map((n) => n.relatedEntityId), [dueTomorrow.body.leaveRequest.id]);
    expectEqual((await notificationsOf(alex, "LEAVE_PROOF_OVERDUE")).length, 0);
  });
  await check("Taylor isn't told 'overdue' (that goes to HR), nor reminded before her shift starts", async () => {
    expectEqual((await notificationsOf(taylor, "LEAVE_PROOF_OVERDUE")).length, 0);
    expectEqual((await notificationsOf(taylor, "CHECKIN_REMINDER")).length, 0);
  });
  await check("HR has one 'overdue', for Taylor's request", () =>
    expectEqual(
      sql(`SELECT n."relatedEntityId" FROM notifications n JOIN users u ON u.id = n."userId" WHERE u.email = 'hr@acme.test' AND n.type = 'LEAVE_PROOF_OVERDUE'`),
      overdue.body.leaveRequest.id,
    ),
  );
  await check("each daily job claimed today once for ACME", () =>
    expectEqual(
      sql(`SELECT string_agg("jobName" || '=' || "runKey", ',' ORDER BY "jobName") FROM job_runs WHERE "companyId" = '${company}' AND "jobName" IN ('leave.proofDueTomorrow', 'leave.proofOverdue', 'gps.purge') AND "runKey" = '${today}'`),
      `gps.purge=${today},leave.proofDueTomorrow=${today},leave.proofOverdue=${today}`,
    ),
  );
  await check("GPS purge: the 100-day-old row lost only its coordinates, the 10-day-old row kept them, no row deleted", () => {
    expectEqual(sql(`SELECT concat_ws('|', "checkInLat", "checkInLng", "checkOutLat", "checkOutLng", "checkInDistanceM", "checkInWithinRadius", "checkInAccuracyM", status) FROM attendance_records WHERE id = '${oldGps}'`), "42|t|12|PRESENT");
    expectEqual(sql(`SELECT concat_ws('|', "checkInLat", "checkOutLng") FROM attendance_records WHERE id = '${recentGps}'`), "6.927100|79.861300");
    // Day close may add rows in the same run, so it's these two that must still be there.
    expectEqual(sql(`SELECT count(*) FROM attendance_records WHERE id IN ('${oldGps}', '${recentGps}')`), "2");
  });
  await check("housekeeping: the 40-day-old claim is gone, the heartbeat stays, and it ran once today (UTC)", () => {
    expectEqual(sql(`SELECT count(*) FROM job_runs WHERE "runKey" = 'forty-days-ago'`), "0");
    expectEqual(sql(`SELECT count(*) FROM job_runs WHERE "jobName" = 'worker.tick'`), "1");
    expectEqual(sql(`SELECT count(*) FROM job_runs WHERE "jobName" = 'housekeeping' AND "companyId" IS NULL`), "1");
  });

  // The switch, over real HTTP: off, nothing; on again, one.
  giveShiftStartingAt("taylor@acme.test", localTime(-2));
  const off = await call(admin, "PATCH", "/company/settings", { checkinReminderEnabled: false });
  await runWorker();
  await check("with the check-in reminder switched off on the settings API, Taylor gets none", async () => {
    expectEqual(off.status, 200);
    expectEqual((await notificationsOf(taylor, "CHECKIN_REMINDER")).length, 0);
  });
  await call(admin, "PATCH", "/company/settings", { checkinReminderEnabled: true });
  await runWorker();
  await check("switched back on, Taylor gets exactly one", async () => expectEqual((await notificationsOf(taylor, "CHECKIN_REMINDER")).length, 1));

  // Real pages.
  const hrPage = await newPage();
  await login(hrPage, "hr@acme.test");
  await check("HR's notifications page shows 'overdue', and it opens Taylor's request", async () => {
    await hrPage.goto("/notifications");
    await hrPage.getByText("Leave proof overdue").first().click();
    await hrPage.waitForURL(`**/leave-requests/${overdue.body.leaveRequest.id}`);
    await hrPage.getByText("Taylor").first().waitFor();
  });

  const alexPage = await newPage();
  await login(alexPage, "alex@acme.test");
  await check("Alex's notifications page: the check-in reminder is marked read and stays put (no web check-in)", async () => {
    await alexPage.goto("/notifications");
    await alexPage.getByText("You haven't checked in yet").first().click();
    await alexPage.waitForTimeout(800);
    if (!alexPage.url().endsWith("/notifications")) throw new Error(`moved to ${alexPage.url()}`);
    expectEqual(sql(`SELECT count(*) FROM notifications WHERE type = 'CHECKIN_REMINDER' AND "readAt" IS NOT NULL AND "userId" = (SELECT id FROM users WHERE email = 'alex@acme.test')`), "1");
  });
  await check("and 'due tomorrow' opens his request", async () => {
    await alexPage.getByText("Leave proof due tomorrow").first().click();
    await alexPage.waitForURL(`**/leave-requests/${dueTomorrow.body.leaveRequest.id}`);
  });
  void webUrl;
}
