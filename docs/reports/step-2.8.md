# Step 2.8 Report: Reminders and housekeeping jobs

Plan: `docs/phase2/plan.md` → 2.8. Checklist: `docs/reports/step-2.8-progress.md`.

**Status: code complete. Typecheck and lint pass, and all 1835 tests pass. The real worker process, the API and the
web pages also ran for real against the test database, in real Chromium: 15 of 15 checks passed. It hasn't run
on a phone yet. That's your checklist below.**

## Read this first: your dev worker is already running it
Your `pnpm dev` runs the worker under `tsx watch`, which reloads whenever a file it imports changes. So I wrote
each job in its own file, tested it on the test DB, and added them all to `jobs.ts` only at the end. Since then,
your dev worker has been running 2.8:
- **Already done, changing nothing:** `gps.purge` for ACME and BETA, and `housekeeping`. Your GPS rows are from
  6 Nov, well inside 90 days, and no `job_runs` row is over 30 days old.
- **Tonight at 22:00:** Jordan (night-shift override) gets "You haven't checked in yet" if he hasn't checked in.
  That's the feature working on your data.
- **Tomorrow is Sunday,** an off day, so no check-in reminders. **On Monday at 09:00** everyone in ACME who hasn't
  checked in gets one. No proof reminders are due: your only request missing proof is `REJECTED`.
- Set `JOBS_ENABLED=false` in `apps/api/.env` if you'd rather hold off.

## What was done
### Before 2.8
- UX backlog in `plan.md`: "My visits: explain an auto-closed visit".

### Runner (`lib/jobs/runner.ts`, `schedule.ts`)
- **Platform-wide jobs** (`PlatformJob`): claimed with no company, so housekeeping runs once for the whole platform.
- **`runsWhileSuspended`:** a job can opt in to run for a suspended company. Only the GPS purge does.
- **`getDueDailyKeys`:** "daily at HH:mm, company time". Reminders give up 2 hours late (§5.4), and housekeeping-type
  jobs catch up for 24 hours.

### The jobs
| Job | When | Sends / does | Switch |
|---|---|---|---|
| `attendance.checkinReminder` | every tick, per employee at shift start + offset | `CHECKIN_REMINDER` to the employee, once per day | `checkinReminderEnabled`, attendance module |
| `leave.proofDueTomorrow` | daily at `dailyReminderTime` | `LEAVE_PROOF_DUE_SOON` to the employee, once per request | `proofRemindersEnabled` |
| `leave.proofOverdue` | daily at `dailyReminderTime` | `LEAVE_PROOF_OVERDUE` to each active HR user except the requester, once per request | `proofRemindersEnabled` |
| `gps.purge` | daily 03:00 | sets the 4 coordinate columns to NULL after `gpsRetentionDays`. **Never deletes a row** | `gpsRetentionDays` |
| `housekeeping` | daily 04:00 UTC | deletes `job_runs` older than 30 days, never the heartbeat | none |

### Mobile
- Tapping a check-in reminder opens the Attendance tab. It points at no record, since none exists yet.
- Proof reminders open the leave request, through the existing `LeaveRequest` target.

**No migration, no new libraries.** Every column used here was added in 2.1, and the GPS indexes in 2.3 and 2.5.

## Decisions the design didn't cover
Please check these. All are in architecture §5.4, and all are easy to change.

| # | Situation | What I did | Why |
|---|---|---|---|
| 1 | **GPS purge for a suspended company, or with modules off** | It still runs (`runsWhileSuspended`) | The location notice promises deletion after N days. That shouldn't depend on billing or a module switch |
| 2 | **Type name for "due tomorrow"** | `LEAVE_PROOF_DUE_SOON`, from `api-phase2.md` | I first wrote `..._DUE_TOMORROW`, then found the API doc already named it. The doc is the client contract |
| 3 | **Half-day leave** | Still reminded | The plan skips full-day leave only, and which half isn't recorded (Q8). A morning half-day gets a reminder at 09:00 |
| 4 | **Someone already marked `ABSENT`, or with any row that day** | Not reminded | Any row means the day is already accounted for |
| 5 | **A site visit with no record** (attendance was off when it was made) | Counts as checked in | The plan says "office or site" |
| 6 | **Proof requests of someone who has left** | No reminder to anyone | Nothing for them to upload, and nothing HR can chase |
| 7 | **Titles** | "Leave proof due tomorrow", "Leave proof overdue" | Any leave type can require proof, and the body names the type |
| 8 | **When proof is overdue** | From the day after `proofDueAt` | Due means "by the end of that date" |
| 9 | **A worker that was down at 03:00 or 04:00 UTC** | Catches up within 24 hours | Both are idempotent, and a missed purge is a privacy matter |
| 10 | **Two passes in the GPS purge** | The indexed `checkInLat IS NOT NULL` pass, then rows with only a check-out position | A site's GPS can be switched on between check-in and check-out |

## New concepts (plain language)
- **Platform-wide job:** most jobs run once per company. Housekeeping is about the system itself, so it runs once
  in all, and its claim row has no company.
- **Catch-up window:** if the worker was off when a job was due, how long it still runs it afterwards. A reminder two
  hours late is noise, so it's dropped. A purge a few hours late is still worth doing.
- **Reading before inserting:** the check-in reminder looks up which reminders it already sent before trying to insert,
  so a 2-hour window doesn't try every insert on every tick. The `dedupeKey` still guarantees "once" if two workers race.
- **Registering last:** a `tsx watch` process reloads on every save. Keeping new code out of its imports until it's tested
  means a half-written job never runs on your data.

## Files changed
**API:** `src/jobs.ts`, `src/worker.ts`, `lib/jobs/runner.ts`, `runner.test.ts`, `lib/notifications.ts`,
`modules/attendance/dayClose.job.ts` (exports its schedule loader). New: `lib/jobs/schedule.ts`, `schedule.test.ts`,
`housekeeping.ts`, `housekeeping.test.ts`, `modules/attendance/checkinReminder.job.ts`, `checkinReminder.test.ts`,
`gpsPurge.job.ts`, `gpsPurge.test.ts`, `modules/leaveRequests/proofReminders.job.ts`, `proofReminders.test.ts`.

**Shared:** `src/notifications.ts`.

**Mobile:** `src/app/notifications.tsx`, `src/__tests__/app/notifications.test.tsx`.

**Scripts:** new `scripts/browser-checks/reminders.mjs`.

**Root:** `CLAUDE.md`, `README.md` (a worker section). No change to `package.json`.

**Docs:** `docs/phase2/plan.md`, `architecture-phase2.md`, `api-phase2.md`, `database-schema-phase2.md`. New:
`docs/reports/step-2.8.md`, `step-2.8-progress.md`.

## Commands run
```
vitest run <affected files>          while working
node scripts/browser-check.mjs ...   test DB only (start --reset --seed, run reminders.mjs, stop), twice
pnpm typecheck                       exit 0
pnpm lint                            exit 0
pnpm test                            exit 0, 9 min 8 s in all, API part 493 s
```
No migration, no `prisma generate`, nothing run against the dev DB except read-only `SELECT`s.

## Test results
| Workspace | Before (2.7) | Now |
|---|---|---|
| shared | 312 | 312 |
| api | 1135 | 1178 |
| mobile | 165 | 167 |
| web | 178 | 178 |
| **Total** | **1790** | **1835** |

The API part took 493 s, against 326 s in 2.7. Your `pnpm dev` (API, web and worker) was running throughout, and nothing
timed out.

**Real servers and real browser** (`scripts/browser-checks/reminders.mjs`, on the **test** database): 15 of 15.
- **Two real worker processes at once, then a third:** Alex got one check-in reminder and one "due tomorrow" for the
  sick leave he filed over HTTP. HR got one "overdue" for Taylor's, and Taylor got none. Each daily job claimed today
  once.
- **GPS purge:** a 100-day-old row lost its four coordinates and kept its distance, within-radius, accuracy and status.
  A 10-day-old row kept everything, and no row was deleted.
- **Housekeeping:** a 40-day-old claim was deleted, and the heartbeat stayed.
- **The switch over the real settings API:** off, so Taylor got no reminder. On again, and she got exactly one.
- **In Chromium:** HR's "Leave proof overdue" opens Taylor's request. Alex's check-in reminder is marked read and stays on
  the page (no web check-in), and his "due tomorrow" opens his request.
- **Console:** 6 errors, all the 401 from the login page's "am I logged in?" probe, 2 per login. That's the same as before.

The first run was 7 of 15. All 8 failures were my script's: it read `body.request` where the API returns
`body.leaveRequest`, and it counted all records when day close rightly added `ABSENT` rows in the same run. It also gave
Taylor a shift after day close had already marked her `ABSENT` for today, which the reminder correctly skips. So she now
gets a later shift up front.

**Each suggested commit, replayed in order on a clean copy of HEAD:** shared, API and mobile each typecheck after every
commit. The copy matched your working tree at the end, so no file is left out. Only typecheck was run per commit. The tests
ran once, on the final tree. The copy has been deleted.

**One slip of mine during the replay:** my first attempt left the copy without `node_modules`, so `npx tsc` downloaded an
unrelated npm package named `tsc` into npx's cache. It only printed a warning. Nothing in the project changed, and the real
replay used the repo's own TypeScript.

Nothing on 4000 or 5173 was stopped or started by me. `/api/v1/health` on 4000 answered 200 with `worker.ok: true`.

## Dev database check
No migration, so no "before and after migration". Row counts of all 22 tables from the start of the work to the end:

| Table | Before | After | Why |
|---|---|---|---|
| `job_runs` | 3 | 6 | Your dev worker's claims for `gps.purge` (ACME, BETA) and `housekeeping` today |
| The other 21 tables | same | same | |

Coordinates on dev: 1 record and 2 visits, the same before and after. No reset, no reseed.

## Your checklist
**No restart needed:** your dev worker already reloaded. Check http://localhost:4000/api/v1/health shows `"ok":true`.
Reload the app in Expo. There's no new native library.

**The plan's "Try it":**
1. **Check-in reminder:** on web as Company Admin, set the check-in reminder offset to 0. Give Alex his own schedule starting
   **2 minutes from now** (employee page, Schedule). Wait until it starts, plus up to 30 s. The phone bell shows "You haven't
   checked in yet", and tapping it opens the Attendance tab. *Do it before Alex's day has closed (21:00 on a weekday with
   company hours, 17:00 on a Saturday). After that he's already `ABSENT` for today, and the reminder rightly skips him.*
2. **Due tomorrow:** set the daily reminder time to **2 minutes from now**. Before it comes, as Alex on the phone, apply for
   sick leave **starting 2 days ago** for 2 days, with no proof. With the default 3-day deadline, it's due tomorrow. At the
   reminder time, Alex gets "Leave proof due tomorrow", and tapping it opens the request.
3. **Overdue:** the next day at the reminder time, HR gets "Leave proof overdue" on the web bell, and clicking it opens the
   request. It's sent once only: the day after, nothing new. *To try it today:* file a sick leave starting **5 days ago**
   before the reminder time, so its proof was due 2 days ago. HR is told the same day.

**Also worth trying:**
4. **Switches:** untick "Remind employees who haven't checked in" and repeat 1 with another employee: nothing. Same for "Remind
   about sick leave proof".
5. **Already checked in:** with a schedule starting in 2 minutes, check in before it starts: no reminder.
6. **Two workers:** with `pnpm dev` running, run `pnpm --filter @employee-saas/api worker` in a second terminal while doing 1:
   one reminder only. Stop it with Ctrl+C.

**Put these back afterwards:** Alex's schedule to **Use company hours**, the reminder time to 09:00, and cancel the test leave.

To see the job runs, in PowerShell:
```
docker exec employee-saas-postgres-1 psql -U employee_saas -d employee_saas -c 'SELECT \"jobName\", \"runKey\", status, attempts, \"lastError\" FROM job_runs ORDER BY \"startedAt\" DESC LIMIT 10;'
```

## Known limitations
- **Nothing has run on a phone yet,** and it's in-app only: pushes come in 2.9.
- **Overdue on a first run:** the plan sends "overdue" for every request still owing proof, however old. On your dev data
  that's none. On a company with a long Phase 1 history it would be one per old request per HR user, once. See question 1.
- **A new HR user** gets "overdue" for requests still owing proof on their first reminder day, since the dedupeKey is per HR
  user. That's what "every active HR user" means, but it can be a burst.
- **A reminder time changed after today's run** doesn't run again today: the run key is the date.
- **A worker outage over 2 hours at reminder time** skips that day's proof reminders. "Overdue" catches up the next day.
  "Due tomorrow" for that day is lost, since by then it's due today.
- **Housekeeping covers only `job_runs`.** `push_messages` and `push_devices` don't exist until 2.9b.
- **The check-in reminder reads the company's hours on every tick,** as day close does. That's one small query, and fine at
  this size.

## Questions for you
1. **Should "overdue" ignore old requests?** For example, only proof due in the last 30 days. Today nothing in your data is
   affected. A real company switching this on later could see a burst of old ones. I recommend a 30-day limit. It's a
   one-line change.
2. **Half-day leave and the check-in reminder (decision 3):** keep reminding, or skip any leave? I recommend keeping it until
   morning/afternoon is recorded (a future requirement from Q8).

## Exact next step
Run the checklist and answer the two questions. After that, **step 2.9a: dev build (no push code)**.
