# Step 2.3 Report — Office attendance

Plan: `docs/phase2/plan.md` → 2.3. Checklist: `docs/reports/step-2.3-progress.md`.

**Status: code complete. Typecheck, lint and all 902 tests pass. The colour fix and
the API were also run for real, against the test database. The mobile screens have
only run in tests, not on a phone. That's your checklist below.**

## Your two decisions
- **`ON_ABSENT_DAY`:** confirmed as written. It replaces `AFTER_HOURS` only on `ABSENT`
  days. The docs already said this, so nothing changed.
- **Paste "lat, lng":** added to the UX backlog in the plan.

## The colour bug was bigger than reported
You reported black when no colour is stored. **A stored colour also showed and saved
as black.**

**Cause:** a colour input can't be empty, so with no default of its own it reports
`#000000`. React Hook Form takes "the value differs from the input's default" to mean
the user already edited the field, so it keeps the black and ignores the form's
default. The earlier tests didn't catch this because none of them looked at this
field.

**Fix** (`CompanySettingsPage.tsx`):
- The input now has a real starting value: the stored colour, or the app's default
  `#4f46e5`, the same constant the app itself uses.
- `primaryColor` is only sent if it differs from the current colour, ignoring letter
  case.

**Your data is fine:** both dev companies have no stored colour, and the audit log has
no `COMPANY_PROFILE_UPDATED` rows, so no profile has been saved in dev at all.

## What was done

### Shared (`packages/shared`)
- **`attendance.ts`** (new): enums, request, response and list schemas.
- **`formatTime`** ("14:05") and **`formatDuration`** ("8h 3m").

### Database (`20261106150000_phase2_attendance`)
- The `attendance_records` table and two enums, with all the GPS columns now, so 2.4
  needs no migration for them. They stay NULL until then.
- Hand-written: 2 partial indexes and 4 CHECKs, as designed.
- **Added to the design:** a unique index on `(companyId, employeeId,
  checkInClientRequestId)`, so a retry is found, and only ever for that employee.
- **Freeze check:** no `ALTER TABLE` on `companies`, `users` or `refresh_tokens`.
- **Back-relation lines added (no SQL):** `Company.attendanceRecords`. Also, on tables
  that aren't frozen, `Employee.attendanceRecords` and `Site.attendanceCheckIns`.
  Nothing on `User`.

### API
- **Five endpoints** behind `requireModule("attendance")`: today, check-in, check-out,
  my history, one record.
- **`attendance.rules.ts`:** all the rules as pure functions, so each can be tested
  with a plain table of values.
- **Viewing a record:** the owner, HR and Company Admin get coordinates. A manager gets
  their direct reports' records without them. Everyone else gets 404.

### The night-shift fix
Check-out no longer works out a date and looks for that day's record. It finds the
employee's **current record** first: their latest check-in, if its close time hasn't
passed. Someone on 22:00–06:00 who checks out at 06:30 closes the night's record. The
same fix covers a day-shift worker staying past midnight.

Check-in, check-out and the Home card all use the same function (`getCurrentDay`), so
they can't disagree. The rule is in architecture §1.3. The section you named, "Problems
found for later steps", is called "Design gaps found for later steps" in `step-2.1.md`.

### Mobile
- **Attendance card on Home:** today's schedule, Check in / Check out, times so far, a
  "Late by 12 min" chip, and worked hours.
- **Attendance tab:** history as an infinite list.
- **Module off:** both are hidden.
- **Offline:** the app says "No internet connection, try again" and queues nothing. Any
  failure to reach the server shows this message, including when your API is down.

### Web
Only the settings hint changed, because working hours now really do apply.

## Changes beyond the literal plan
| Change | Why |
|---|---|
| **A check-in after the day's close time is refused** (`DAY_ALREADY_CLOSED`) | The design didn't cover this. **Please confirm: question 1.** |
| **A check-out can return `DAY_ALREADY_CLOSED` before the job exists** | A record past its close time counts as closed, even though nothing writes `autoClosedAt` until 2.7. Otherwise forgetting to check out would let you check out days later. |
| **Forgetting yesterday's check-out doesn't block today** | Today gets its own record. Yesterday's stays open until 2.7 marks it `INCOMPLETE`. |
| **A check-in on a day off closes after 16 hours** | With no schedule there's no shift end to count from. 2.7's job has to handle this too, and that's now in the plan. |
| **`LONG_SHIFT` can be set at check-out** | The design said this couldn't happen. It can: 07:00 to midnight with a 720-minute close works out at 17 hours. |
| **A check-out keeps the status** | Recomputing it would judge the morning's check-in against a grace period someone may have changed since. |
| **No early-leave minutes on half-day leave** | Same reason as lateness: we don't know which half was taken. |
| **A shift starting exactly at the half-day end is worked in full** | The design said "after". At exactly that time, the end would equal the start, meaning 24 hours. |
| **Two more flags in the schema doc's list** | `LOCATION_UNAVAILABLE_AT_CHECKOUT` and `STALE_LOCATION` were in architecture §3.2 but missing from the list. |

## Moved to later steps, on purpose
- **2.4:** `checkInSiteId`, the `NO_OFFICE_SITE` flag, and `gpsRequired` + office site
  in today's response. A location sent now is discarded, and a test proves it.
- **2.5:** the open visit in today's response, and closing a visit at check-out.
- **2.6:** `/attendance/team`, `/attendance`, corrections, overrides, and the visits and
  correction history on a record.
- **2.7:** closing an employee's open record when they're deactivated. No step named
  this, so I added it to the plan.

## New concepts (plain language)
- **Idempotent retry:** "do it again" gives the same result as doing it once. The phone
  makes one id per tap and resends it if the response is lost. The server finds the
  existing row and returns it, so a lost response never shows a false error.
- **Letting a unique index settle a race:** two simultaneous check-ins can both see "no
  record yet". Only one insert can succeed, and the other is turned into a normal
  `ALREADY_CHECKED_IN`.
- **`networkMode: "always"`:** by default React Query pauses a request when the phone is
  offline and sends it later. That would be exactly the offline queue you ruled out,
  with a check-in arriving at the wrong time, so it's switched off here.
- **Faking only the clock in tests:** `vi.useFakeTimers({ toFake: ["Date"] })` changes
  what time it is, while real timers and database calls keep working. That lets a test
  run "23:50 on the 3rd, then 06:30 on the 4th".

## Files changed
**Shared**
- `packages/shared/src/dates.ts`, `dates.test.ts`, `index.ts`
- New: `attendance.ts`, `attendance.test.ts`

**API**
- `apps/api/prisma/schema.prisma`
- New: `apps/api/prisma/migrations/20261106150000_phase2_attendance/migration.sql`
- `apps/api/src/app.ts`, `lib/leaveDays.ts`, `lib/tenantPrisma.ts`
- New: `apps/api/src/modules/attendance/attendance.routes.ts`, `attendance.service.ts`,
  `attendance.rules.ts`, `attendance.rules.test.ts`, `attendance.test.ts`

**Mobile**
- `apps/mobile/src/app/(tabs)/_layout.tsx`, `(tabs)/index.tsx`, `strings.ts`
- New: `src/app/(tabs)/attendance.tsx`, `components/AttendanceCard.tsx`,
  `components/AttendanceStatusChip.tsx`, `lib/attendance.ts`,
  `__tests__/app/attendance.test.tsx`, `__tests__/components/AttendanceCard.test.tsx`

**Web**
- `apps/web/src/lib/companyContext.tsx`, `routes/CompanySettingsPage.tsx`,
  `routes/CompanySettingsPage.test.tsx`, `strings.ts`

**Docs**
- `docs/phase2/plan.md`, `architecture-phase2.md`, `database-schema-phase2.md`,
  `api-phase2.md`
- New: `docs/reports/step-2.3.md`, `step-2.3-progress.md`

## Commands run
```
prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script
pnpm run db:migrate:test         test DB
prisma migrate deploy            dev DB
prisma generate                  FAILED on a file lock (see Known limitations)
pnpm typecheck                   exit 0
pnpm lint                        exit 0
pnpm test                        exit 0, 264 s
tsx prisma/seed.ts               test DB only, for the browser check
TRUNCATE (every table)           test DB only, with your permission, before the re-run
```

## Test results
| Workspace | Before (step 2.2) | Now |
|---|---|---|
| shared | 237 | 259 |
| api | 318 | 516 |
| mobile | 29 | 54 |
| web | 68 | 73 |
| **Total** | **652** | **902** |

**Real browser and real server:** a throwaway script, not in the repo, using a temporary
API on port 4001 and Vite on 5199, on the **test** database. All 22 checks passed.
- **Colour, in real Chromium:** the default shows, saving the name sends no colour, a
  picked colour is sent, stored, applied and survives a reload, and saving it unchanged
  sends no colour.
- **Attendance, over real HTTP:** check-in, retry, double check-in, check-out, today and
  history.
- **Console errors:** three failed requests, all on the login page before signing in:
  `401 /auth/me` twice and `401 /auth/refresh` once. That's the expected session check.
  There were no failed requests after login and no other console errors.

## Dev database check
Row counts of every table, from before the migration to after everything else:

| Table | Before | After | Why |
|---|---|---|---|
| `_prisma_migrations` | 8 | 9 | This step's migration |
| `attendance_records` | none | 0 | New table, empty |
| `refresh_tokens` | 44 | 45 | **Not from this work:** a desktop browser session on the dev API refreshed its login at 06:59 UTC. The previous token shows as replaced. My checks used the test database. |
| The other 14 tables | same | same | |

Both companies' colour, timezone, modules, working hours and GPS radius are unchanged.
No reset and no reseed.

## Your checklist
**First stop and restart `pnpm dev`, running this while it's stopped:**
```
pnpm --filter @employee-saas/api db:generate
```
See the first item under "Known limitations": the dev API isn't running at the moment.

**Know your hours before testing the phone.** ACME's dev settings are 08:30–17:00, not
the plan's 09:00:
- Late after **08:40**.
- The day closes at **21:00**. After that, a check-in is refused, by design for now
  (question 1).
- There's **one check-in/out pair per day** and no way to undo it until HR corrections
  in 2.6. Alex gets one go per day, so use `manager@acme.test` or `hr@acme.test` for a
  second run.

**Colour, on web as your ACME Company Admin:**
1. Settings → Company profile: the swatch is indigo, not black.
2. Change only the name and Save. Then check in PowerShell that no colour was stored:
   ```
   docker exec employee-saas-postgres-1 psql -U employee_saas -d employee_saas -c "SELECT code, name, \"primaryColor\" FROM companies;"
   ```
3. Pick a colour, Save and reload: the swatch and the app's accent both show it.

**Phone, as Alex:**
4. Home has an Attendance card with today's schedule, and there's an Attendance tab.
5. **Airplane mode**, then tap Check in: "No internet connection, try again", the button
   stays, and nothing is recorded (step 11 shows this). Turn airplane mode off.
6. Tap Check in: the time appears, with "Present" or "Late by N min".
7. The button now says Check out. Pull down to refresh: still the same.
8. Tap Check out: the times and worked hours appear, and "You're done for today."
9. Attendance tab: today is listed with its status and times. If you have many days,
   scroll to check more load (no test covers real scrolling).

**Module off:**
10. Log in as a BETA employee: no card and no tab. Or untick Attendance for ACME on web,
    pull down on Home (the tab can take up to a minute), then tick it again.

**Rows:**
11. In PowerShell:
    ```
    docker exec employee-saas-postgres-1 psql -U employee_saas -d employee_saas -c "SELECT \"workDate\", status, \"checkInAt\", \"checkOutAt\", \"workedMinutes\", \"lateMinutes\", flags FROM attendance_records ORDER BY \"createdAt\";"
    ```

**Night shift:** covered by tests on the API. You can try it on the phone in 2.6, once
overrides exist.

## Known limitations
- **The dev API isn't running right now.** Nothing was listening on port 4000 at
  13:27, and `/health` didn't answer. Your `tsx watch` process is alive but its server
  process is gone, while Vite on 5173 and Expo are still up.
  - I only killed my own temporary servers, PIDs 35480 and 3572, both listening on 4001.
  - **Most likely cause, not confirmed:** my source edits made the watcher restart, and
    a restart crashed, for example mid-way through my edits or because of the Prisma
    client below. I didn't start anything on 4000 to find out.
  - The same code started fine on 4001 with the test settings. **If `pnpm dev` still
    fails after the commands above, send me the error.**
- **`prisma generate` couldn't finish**, as in 2.2: the engine file was locked. The tests
  and the temporary API ran against the updated client code. The command above finishes
  it.
- **The mobile screens have only run in tests**, with a fake server.
- **Until 2.7, nothing closes a forgotten check-out.** The row stays `PRESENT` or `LATE`
  with no check-out. It's refused for check-out and doesn't block the next day.
- **Corrections in 2.6 have a gap to settle.** There's no stored copy of the grace period
  a record was judged against. Recomputing lateness after a correction would use the
  current setting, unless 2.6 adds a column.
- **A retry after the first check-out response is lost** gets `ALREADY_CHECKED_OUT`,
  because the design gives check-out no request id. The card refreshes to the right
  state, and the message is accurate.

## Questions for you
1. **Should a check-in after the day's close time be refused?** I made it refuse, because
   from 2.7 day close has already written an `ABSENT` row by then, and a check-in the job
   closes straight away would be useless. The catch: with ACME's hours, someone arriving
   at 21:30 can't check in, and HR has to add the day in 2.6. The alternative is to accept
   it and have it close some hours later, which makes the job and the rows more complex.
   I recommend keeping the refusal. It's easy to change before 2.7.
2. **Should Check out ask "Are you sure?"** It's one tap today, and a mistaken one can't
   be undone without HR, and until 2.6 not at all. I didn't add it because it isn't in the
   plan. I recommend adding it, and it would be a small change.

## Exact next step
Run the checklist and answer the two questions. After that, **step 2.4 GPS verification +
privacy disclosure**. The Expo account and Firebase project from architecture §4.7 can
start any time; they take calendar time, not code time.
