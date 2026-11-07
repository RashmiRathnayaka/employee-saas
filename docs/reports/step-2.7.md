# Step 2.7 Report: Job runner + day close

Plan: `docs/phase2/plan.md` → 2.7. Checklist: `docs/reports/step-2.7-progress.md`.

**Status: code complete. Typecheck and lint pass, and all 1790 tests pass. The real worker process,
the API and the web pages also ran for real against the test database, in real Chromium: 30 of 30
checks passed. It hasn't run against your dev data or on a phone. That's your checklist below.**

## Read this before you restart `pnpm dev`
Your running `pnpm dev` doesn't have the worker. Once you restart it, the worker **starts writing to
your dev database**, as the plan intends. On its first tick, going by your dev data on 2026-11-07:

| Who | What happens | Notified |
|---|---|---|
| Taylor, Morgan | Their open records from 6 Nov become `INCOMPLETE` | Yes, "You didn't check out" |
| Alex | The site visit left open at My Test Site on 6 Nov becomes `AUTO_CLOSED` | Yes |
| Everyone | **No `ABSENT` rows for 6 Nov or earlier** (see decision 1) | No |

From then on, today counts: anyone in ACME with no check-in is marked `ABSENT` when their close time
passes. That's 17:00 today, a Saturday half day (13:00 + 240 min). Jordan's override closes at 06:00
tomorrow. Set `JOBS_ENABLED=false` in `apps/api/.env` if you'd rather hold off.

## What was done

### Before 2.7
- **Test workers:** web and mobile are capped at 4 (it was 11 on this laptop). Web takes 27 s and mobile
  9 s, with no timeouts, so I didn't lengthen `testTimeout`.
- **`scripts/browser-check.mjs`:** `start [--reset] [--seed]`, `run <check>`, `stop`, `status`. It's
  documented in its header and in CLAUDE.md. It refuses a `.env.test` that isn't a `*_test` database, and
  can only stop what's on 4001 and 5199. It leaves no temporary Vite config behind.

### Database (`20261107090000_phase2_job_runs`)
- New: the `job_runs` table and the `JobRunStatus` enum.
- New: `company_settings.attendanceEnabledAt` (see decision 1).
- Hand-written: the unique index with `NULLS NOT DISTINCT`, and setting that column for companies
  already using attendance.
- **Freeze check:** no `ALTER TABLE` on `companies`, `users` or `refresh_tokens`.
- **Back-relation lines added (no SQL):** `Company.jobRuns`. Nothing on `User`.

### Runner (`lib/jobs/runner.ts`, `worker.ts`, `jobs.ts`)
- The tick loop, every 30 s, with one try/catch per job per company.
- **Claims:** whoever's insert succeeds runs the job. A failed run retries on a later tick, and a run
  stuck for 15 minutes can be taken over, up to 3 attempts.
- **`/health`** gains `worker: { lastTickAt, ok }`.
- `pnpm dev` starts the worker. `JOBS_ENABLED=false` turns it off, and `worker --once` runs one tick.

### Day close (`modules/attendance/dayClose.job.ts`)
- **Auto-close:** `INCOMPLETE` + `AUTO_CLOSED`, keeping the lateness, plus one notification. It includes
  a check-in with no schedule (check-in + 16 hours).
- **Absent marking:** `ABSENT`, `ON_LEAVE` (with `HALF_DAY_LEAVE` for half a day) or `HOLIDAY`, per employee,
  using the same schedule function as a check-in. So the override's night shift and half day from your 2.6
  follow-up both close correctly.
- **The two items from 2.5:** forgotten visits close at check-in + 16 hours, and waiting visits get linked,
  with `AFTER_HOURS` becoming `ON_ABSENT_DAY`.

### Hooks (`modules/attendance/attendanceHooks.ts`)
- Leave approved, revoked or cancelled, and a holiday added or deleted: the rows are set again from the facts.
- Deactivating an employee closes everything of theirs at once.

### Mobile
- Tapping "You didn't check out" opens the Attendance tab, and the visit version opens My visits.

## Decisions the design didn't cover
Please check these. All are in the docs, and all are easy to change now. **The first two change what the plan
said, so they matter most.**

| # | Situation | What I did | Why |
|---|---|---|---|
| 1 | **Attendance just switched on, or the worker's first run** | A new column, `attendanceEnabledAt`. A day only counts if the module was on when that day started. | The plan's 48-hour catch-up would mark everyone `ABSENT` for days when nobody could check in. On your dev data, that was everyone for 5 and 6 Nov |
| 2 | **When a `HOLIDAY` row is written** | At midnight, company time | A holiday has no shift end. A row any earlier would refuse someone coming in to work it (§1.3 and §1.5) |
| 3 | **Holiday and leave on the same day** | `HOLIDAY` | §1.2 and §5.4 disagreed. I followed §1.2, since a leave doesn't spend a day on a holiday |
| 4 | **Holiday on a weekly off day** | No row | §1.4: it's still an off day |
| 5 | **Forgotten visit** | Check-in + 16 hours, as suggested, under the `sites` module, with its own notification, `SITE_VISIT_AUTO_CLOSED` | The employee needs to know, and to ask HR |
| 6 | **Closing a record with visits open** | Only the visits linked to it close | After an outage, closing yesterday's record mustn't end the visit someone is on today |
| 7 | **Visit waiting on a day that becomes `ON_LEAVE` or `HOLIDAY`** | Linked, and stays `AFTER_HOURS` | The same as a visit made after the row existed |
| 8 | **`ON_LEAVE` or `HOLIDAY` row later becoming `ABSENT`** | A linked `AFTER_HOURS` visit becomes `ON_ABSENT_DAY` | Otherwise HR's report would miss the contradiction |
| 9 | **Leave approved for a day they checked in** | Gains the flag and keeps its status, including a half day's `LATE` | The doc only covers the flag going away. HR can correct it, and the correction then ignores lateness |
| 10 | **A row becoming `HOLIDAY`** | Loses its schedule snapshot | Otherwise an HR correction would judge the check-in against a shift that wasn't on |
| 11 | **Deactivation** | No notification, and the counts go in the audit row | The login is deactivated in the same transaction, and "ask HR" wouldn't make sense |
| 12 | **Heartbeat** | One `job_runs` row, updated each tick | Most ticks claim nothing, so "the latest row" wouldn't show the worker is alive |

**Something you should know about the plan's hooks:** revoking only applies to leave that hasn't started, and
cancelling only to pending leave, so neither normally finds a row to change today. I wired both as planned, and
tested them with rows placed by hand. Leave approval and holidays are the hooks you'll really see working.

## New concepts (plain language)
- **Worker:** a second program from the same code, with no web server. It wakes every 30 s and asks "is
  anything due?", so a slow job never slows a request.
- **Claim row:** before running, a worker inserts a row. The database lets only one insert succeed, so only
  one worker runs the job, however many exist.
- **Idempotent:** running it twice gives the same result as once. Every write here says "only if still open"
  or "skip if it exists", which is why a retry or a second worker is harmless.
- **Fake clock:** a job is handed the time rather than reading it, so a test can say "it's 21:00 in Colombo on
  3 March" and get the same answer every day.
- **Reconciling, not flipping:** a hook works out what a row should be from today's facts, rather than changing
  it one way. Repeating it, or calling it from several places, can't get it wrong.

## Files changed
**Tests and scripts:** `apps/web/vite.config.ts`, `apps/mobile/package.json`. New: `scripts/browser-check.mjs`,
`scripts/browser-checks/smoke.mjs`, `reset-test-db.sql`, `day-close.mjs`.

**Shared:** `health.ts`, `notifications.ts`.

**API:** `package.json`, `.env.example`, `prisma/schema.prisma`, `prisma/seed.ts`, `src/config.ts`,
`lib/notifications.ts`, `modules/attendance/attendance.rules.ts`, `modules/company/company.service.ts`,
`modules/employees/employees.service.ts`, `modules/health/health.routes.ts`, `health.test.ts`,
`modules/leaveRequests/leaveDecisions.service.ts`. New: the migration, `src/worker.ts`, `src/jobs.ts`,
`lib/jobs/runner.ts`, `runner.test.ts`, and in `modules/attendance/`: `dayClose.job.ts`, `dayClose.rules.ts`,
`dayClose.rules.test.ts`, `dayClose.rules.testHelpers.ts`, `dayClose.test.ts`, `attendanceRows.ts`,
`attendanceHooks.ts`, `attendanceHooks.test.ts`.

**Mobile:** `src/app/notifications.tsx`, `src/__tests__/app/notifications.test.tsx`.

**Root:** `package.json`, `CLAUDE.md`, `README.md`.

**Docs:** `docs/phase2/plan.md`, `architecture-phase2.md`, `api-phase2.md`, `database-schema-phase2.md`.
New: `docs/reports/step-2.7.md`, `step-2.7-progress.md`.

**No new libraries.**

## Commands run
```
prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script
pnpm run db:migrate:test             test DB
prisma migrate deploy                dev DB
prisma generate                      FAILED on a file lock (see Known limitations)
node scripts/browser-check.mjs ...   test DB only (start --reset --seed, run, stop)
worker.ts --once                     test DB only, including two at once
pnpm dev                             once, with DATABASE_URL set to the test DB and PORT=4002, to prove it starts the worker
pnpm typecheck                       exit 0
pnpm lint                            exit 0
pnpm test                            exit 0, 6 min 13 s in all, API part 326 s
```

## Test results
| Workspace | Before | Now |
|---|---|---|
| shared | 312 | 312 |
| api | 992 | 1135 |
| mobile | 163 | 165 |
| web | 178 | 178 |
| **Total** | **1645** | **1790** |

The "before" figures for mobile and web were measured today. The API's is the new total minus the 143 tests this
step added. It wasn't run separately, and shared didn't change.

**Real servers and real browser** (`scripts/browser-checks/day-close.mjs`, on the **test** database): 30 of 30 on
the final run.
- **Over real HTTP, with the real worker process:** a forgotten check-in closed, and check-out then answers
  `DAY_ALREADY_CLOSED`. Absent rows, with a waiting visit linked. Sick leave filed afterwards flipped a row to
  `ON_LEAVE` in the same request. A holiday added and deleted flipped rows both ways. Deactivating someone closed
  their record and visit.
- **Two real workers at once:** one row per employee, one claim, one heartbeat, one notification each.
- **In real Chromium:** the employee's notification opens their record. HR's page, with the browser set to New York,
  shows the rows and "Has a site visit that day". The manager sees the team's flipped day.
- **Console:** 9 errors, all the 401 from the "am I logged in?" probe on the login page, 3 per login. That's the
  same before this step.

The first run was 28 of 30. Both failures were my script's, not the app's: it missed the `NO_OFFICE_SITE` flag that
was rightly on the record, and looked for "Absent" where the chip shows "ABSENT". I also made the page checks look
in the named person's row, so they can't match the wrong text.

**`pnpm dev`:** with its database forced to the test DB, the worker's heartbeat moved and `/health` said `ok: true`.
The dev DB's `job_runs` stayed at 0. I stopped it by the process ID I started.

**Each suggested commit, replayed in order on a clean copy of HEAD:** each one typechecks, and those adding behaviour
pass their new tests (25, 85 and 34). The copy matched your working tree at the end, so no file is left out. That
copy has been deleted. This closes the limitation from 2.6.

Nothing on 4000 or 5173 was stopped or started by me. `/api/v1/health` on 4000 answered 200 at the end.

## Dev database check
Row counts of all tables, from before the migration to the end of the work:

| Table | Before | After | Why |
|---|---|---|---|
| `_prisma_migrations` | 11 | 12 | This step's migration |
| `job_runs` | none | 0 | New table, empty |
| The other 19 tables | same | same | |

The migration did change one value: `company_settings.attendanceEnabledAt` on ACME is now 2026-11-07 00:00 UTC. BETA's
stays empty. No reset and no reseed, and no worker has run against this database.

## Your checklist
**First: stop `pnpm dev`, run this while it's stopped, then start it again.** See "Read this before you restart" above.
```
pnpm --filter @employee-saas/api db:generate
```
You should now see a `dev:worker` line in the output. Check it's alive: http://localhost:4000/api/v1/health shows
`"worker":{"lastTickAt":"...","ok":true}`. Reload the app in Expo. There's no new native library.

**First tick, on your data:**
1. Phone as Taylor: the bell shows "You didn't check out", and tapping it opens the Attendance tab, where 6 Nov is
   Incomplete. Morgan gets the same, and Alex gets "You didn't check out of a site", which opens My visits.
2. Web as HR, Attendance, 6 Nov: Taylor and Morgan are `INCOMPLETE`, and nobody is `ABSENT`.

**The plan's "Try it":**
3. On a **weekday**, web as Company Admin: set auto-checkout to 30 min. On the employee page for Alex, set his own
   schedule to end 25 minutes ago, with a start at least an hour before that. *On a Saturday an override's half day ends
   halfway through the shift, so the arithmetic won't work: use a weekday, or allow for it.*
4. Phone as Alex: check in, and don't check out. It'll show LATE, which is expected.
5. About 5 minutes later, the record is `INCOMPLETE` and the phone shows "You didn't check out". Tapping Check out is no
   longer offered.
6. The next morning, web as HR, Attendance, yesterday: whoever never checked in is `ABSENT`.
7. As Taylor on the phone, apply for sick leave for that day, and approve it as `manager@acme.test` → the row flips to
   `ON_LEAVE`.
8. **Two workers:** with `pnpm dev` running, run this in a second terminal. `pnpm dev` itself can't run twice, because the
   ports clash. Repeat steps 3-5 for another employee: there's only one notification.
   ```
   pnpm --filter @employee-saas/api worker
   ```
   Stop it with Ctrl+C.

**Put these back afterwards:** auto-checkout to 240, and Alex's override off (**Use company hours**).

**Also worth trying:**
9. **Holiday:** on web, add a holiday for a past day with `ABSENT` rows: they become `HOLIDAY`. Delete it: they flip back.
10. **Holiday today:** add one, and check in on the phone: it works, flagged as a day off. No `HOLIDAY` rows appear until
    midnight. Delete it afterwards.
11. **Deactivate:** with a test employee checked in, deactivate them on web. The record is `INCOMPLETE` straight away.
12. **Visit on an absent day:** on a day past the close time with no check-in, check in at a site before the next tick
    (about 30 s). The visit is `AFTER_HOURS`, and after the tick it says the day was marked absent, and HR's row shows
    "Has a site visit that day". It's a narrow window, and the tests cover it.
13. **Module off:** untick Attendance. Nothing new is closed or marked. Tick it again, and the days it was off are not marked
    absent. Note: today isn't either, if the shift had already started.

To see the rows, in PowerShell:
```
docker exec employee-saas-postgres-1 psql -U employee_saas -d employee_saas -c 'SELECT \"jobName\", \"runKey\", status, attempts, \"lastError\" FROM job_runs ORDER BY \"startedAt\" DESC LIMIT 10;'
```

## Known limitations
- **`prisma generate` couldn't finish**, as in earlier steps: the engine file is locked by your running dev API. The client code
  did update, and tests ran on it. The command above finishes it cleanly.
- **Your dev API restarted itself during my edits**, because `tsx watch` saw them. I never restarted it. `/health` there says
  `ok: false` until you run a worker, which is correct.
- **Nothing has run on a phone or against your dev data.**
- **Stopping the worker gently is untested.** It waits for the tick in progress on Ctrl+C. I stopped my test run by force, because
  Windows has no simple way to send that signal to another process. If it's killed mid-job, the next tick or the 15-minute recovery
  picks it up.
- **A worker outage over about 48 hours leaves older days unmarked**, by design. Forgotten records and visits still close, whenever
  they're from. HR can add a missing record.
- **Reactivated or newly added employees during an outage:** there's no history of when someone was inactive, or was added. If the
  worker is catching up on the last two days, they can be marked `ABSENT` for days in that window, as long as the joining date is
  earlier. HR can correct it.
- **An override added after a date has finished** doesn't write a row for that person that day, since the date isn't scanned again.
- **A very narrow race:** a leave approved at the same instant as that row is written could leave `ABSENT` on an approved day. Day
  close checks again after writing, which covers almost all of it. Re-saving wouldn't fix it, but HR can correct the row.
- **`job_runs` isn't purged yet.** That's `housekeeping` in 2.8. It grows by a few rows per company per day.
- **Companies are handled one at a time,** so a slow one delays the next. That's fine at this size.
- **`attendanceEnabledAt` isn't in the shared settings schema.** `GET /company/settings` does return it, since that returns the row,
  but no client reads it.
- **The worker cap is a fixed 4,** not a share of the CPU. A machine with far fewer threads could lower it.

## Questions for you
1. **Are you happy with `attendanceEnabledAt` (decision 1)?** It's the one addition to the plan's schema. The alternative is to accept
   false `ABSENT` rows whenever attendance is switched on. I recommend keeping it.
2. **Should a forgotten visit also tell the manager?** Now only the employee hears. The manager sees "On site now" clear, with no
   explanation. I recommend leaving it, to avoid noise, as with HR in §1.6.

## Exact next step
Run the checklist and answer the two questions. After that, **step 2.8 Reminders and housekeeping jobs**.
