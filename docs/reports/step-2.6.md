# Step 2.6 Report: HR attendance views, corrections, schedule overrides

Plan: `docs/phase2/plan.md` → 2.6. Checklist: `docs/reports/step-2.6-progress.md`.

**Status: code complete. Typecheck and lint pass, and all 1617 tests pass. The API and web
pages also ran for real against the test database, in real Chromium: 36 of 36 checks passed.
The mobile changes have only run in tests, not on a phone. That's your checklist below.**

## What was done

### Asked for before 2.6
- **"Check in at <site>?"** in the site picker. It says the manager is told and the day may
  start, and adds that the location is recorded at a GPS site. Cancel sends nothing and reads
  no location. Tests cover both answers.
- **Visit detail for HR and Company Admin:** a Details button on each visit opens check-in and
  check-out coordinates, accuracy, distance and "Open in Google Maps". Managers have no button
  and no way in. Tests cover both roles, and the real-browser check confirmed that no API
  response to the manager carried a coordinate.
- **Backlog:** "Web portal scrolls sideways at phone width (app shell sidebar)" added.
- **`AFTER_HOURS` past the close time stays unlinked with no row:** no code change, recorded as
  confirmed in the docs.

### Database (`20261106210000_phase2_schedules_corrections`)
- New tables: `employee_schedules` and `attendance_corrections`.
- Hand-written: 3 CHECKs on schedules, and 2 on corrections (exactly one target, reason of at
  least 5 characters).
- **Freeze check:** no `ALTER TABLE` on `companies`, `users` or `refresh_tokens`. The new foreign
  key to `users` lives on the new table.
- **Back-relation lines added (no SQL):** `Company.employeeSchedules`,
  `Company.attendanceCorrections`, `User.attendanceCorrections`. On tables that aren't frozen:
  `Employee.schedules`, `AttendanceRecord.corrections`, `SiteVisit.corrections`.

### API
- **Schedules:** `GET /schedule/me` (today and the next 13 days), and `GET`, `PUT`, `DELETE
  /employees/:id/schedule`, audited.
- **The override now decides check-ins:** lateness, grace, working days, night-shift work dates
  and the Home card all follow it. Past records keep their snapshot.
- **Lists:** `GET /attendance` and `GET /attendance/team`, with names, no coordinates, and
  `ON_ABSENT_DAY` on an `ABSENT` row until it's resolved.
- **Corrections:** `PATCH /attendance/:id/correct`, `POST /attendance` and `PATCH
  /site-visits/:id/correct`. Reason required, status recomputed, self-correction blocked, and
  history, audit and `ATTENDANCE_CORRECTED` all in one transaction.
- **History** on `GET /attendance/:id` and `GET /site-visits/:id`.

### Web
- **Attendance page:** HR and Company Admin see everyone, with date, status and department
  filters. Managers see their team, read-only.
- **Record page:** times, flags, that day's visits and correction history. Exact positions for HR
  and Company Admin only.
- **Dialogs:** correct a record, add a missing record, correct a visit. All times are entered in
  company time.
- **Schedule section on the employee page:** HR and Company Admin edit it, and a manager reads
  their team's.
- **Notifications:** a corrected record opens its page.

### Mobile
- **My schedule** on the Attendance tab: the next 3 days, expanding to 14. A night shift says
  "(next day)".
- **"Corrected by HR"** on the Home card, the history and My visits.
- **Tapping a correction notification** opens the Attendance tab or My visits.

## Decisions the design didn't cover
Please check these. All are in the docs, and all are easy to change now.

| Situation | What I did | Why |
|---|---|---|
| **A correction's lateness and the grace period** | The record's schedule snapshot, with the grace period as it is now | The snapshot doesn't store grace |
| **How far a corrected time can go** | Not in the future, check-in on the work date (a night shift may use the next day), check-out within 24 hours | Corrected times have no GPS check, and a mistyped date would otherwise produce a 32-hour shift |
| **Removing a check-out** | Not possible. It can only be changed | HR sets the real time. An open past day would have no meaning |
| **A correction that changes nothing** | `400 NOTHING_TO_CORRECT`, with no history or notification | It shouldn't tell an employee their attendance changed |
| **Two people changing a row at once** | The second gets `409 RECORD_CHANGED` | So an employee's check-out isn't silently overwritten |
| **A record created for a day with an unlinked visit** | Links the visit and keeps its flag | Otherwise the record page wouldn't show it |
| **A day before the joining date** | Refused | Same rule as day close (§1.5) |
| **Correcting a visit** | Leaves its flags and the day's record alone. A check-out closes it | Each has its own correction |
| **Correcting a record's check-out with a visit open** | The visit stays open | HR corrects the visit separately. It's visible under "On site now" |
| **Correction reason visible to** | The employee, their manager, HR | The design only says "with the reason" for the employee. The manager already sees the day |
| **HR changing their own schedule** | Allowed, and audited | Only correcting attendance is blocked for oneself. See question 1 |
| **Web notification for a corrected visit** | Marks it read and stays put | The web has no page of one's own visits |

**A rule I fixed:** a half day used to extend a short shift. With an override of 06:00-10:00, a
Saturday would have ended at 13:00. It now keeps its own end.

## New concepts (plain language)
- **Wall-clock boxes:** a date box and a time box hold plain text in the company's timezone. A
  `datetime-local` box would be read in the browser's timezone, so HR on a laptop set to another
  zone would save the wrong moment.
- **Sending only what changed:** the boxes have no seconds. Resending an untouched 09:30:41 as
  09:30:00 would look like a correction nobody made.
- **Optimistic concurrency:** the update says "only if `updatedAt` is still what I read". If
  someone else wrote first, it matches no row, and the person is told to look again. Nothing
  has to be locked while they fill in the form.

## Files changed
**Shared:** `attendance.ts`, `attendance.test.ts`, `siteVisits.ts`, `notifications.ts`, `index.ts`.
New: `schedules.ts`, `schedules.test.ts`.

**API:** `prisma/schema.prisma`, `src/app.ts`, `lib/tenantPrisma.ts`,
`modules/attendance/attendance.routes.ts`, `attendance.rules.ts`, `attendance.rules.test.ts`,
`attendance.service.ts`, `modules/siteVisits/siteVisits.routes.ts`, `siteVisits.service.ts`.
New: the migration, `modules/attendance/attendanceAdmin.service.ts`, `attendanceAdmin.test.ts`,
`correctionRows.ts`, `correctionRules.ts`, and `modules/schedules/` (routes, service, test).

**Mobile:** `strings.ts`, `app/site-picker.tsx`, `app/(tabs)/attendance.tsx`, `app/my-visits.tsx`,
`app/notifications.tsx`, `components/AttendanceCard.tsx`, and the tests for `site-picker`,
`attendance`, `my-visits` and `notifications`. New: `components/MyScheduleCard.tsx`,
`lib/schedule.ts`, `lib/schedule.test.ts`.

**Web:** `App.tsx`, `strings.ts`, `lib/apiClient.ts`, `lib/navigation.ts`, `lib/navigation.test.ts`,
`lib/useOpenNotification.ts`, `components/StatusBadge.tsx`, `routes/EmployeeDetailPage.tsx`,
`routes/SitesPage.tsx`, `routes/SiteVisitsPage.tsx`, `routes/SiteVisitsPage.test.tsx`,
`routes/NotificationsPage.test.tsx`. New: `routes/AttendancePage.tsx`, `AttendancePage.test.tsx`,
`AttendanceRecordPage.tsx`, `components/AttendanceDialogs.tsx`, `AttendanceFlags.tsx`,
`CompanyTimeFields.tsx`, `CorrectionHistory.tsx`, `EmployeeScheduleCard.tsx`,
`EmployeeScheduleCard.test.tsx`, `MapLink.tsx`, `PositionDetails.tsx`, `VisitDetailDialog.tsx`,
`lib/companyTimeInput.ts`, `companyTimeInput.test.ts`, `maps.ts`.

**Docs:** `docs/phase2/plan.md`, `architecture-phase2.md`, `api-phase2.md`,
`database-schema-phase2.md`, `permissions-phase2.md`. New: `docs/reports/step-2.6.md`,
`step-2.6-progress.md`.

**No new libraries**, so nothing was installed with `npx expo install`.

## Commands run
```
prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script
pnpm run db:migrate:test           test DB
prisma migrate deploy              dev DB
prisma generate                    FAILED on a file lock (see Known limitations)
tsx prisma/seed.ts                 test DB only, for the real-server check
TRUNCATE (all tables)              test DB only, between browser runs
pnpm typecheck                     exit 0
pnpm lint                          exit 0
pnpm test                          exit 0, API part 279 s
```

## Test results
| Workspace | Before (step 2.5) | Now |
|---|---|---|
| shared | 291 | 312 |
| api | 741 | 965 |
| mobile | 141 | 162 |
| web | 96 | 178 |
| **Total** | **1269** | **1617** |

**Real servers and real browser:** a throwaway script, not in the repo, using a temporary API on
port 4001 and Vite on 5199, on the **test** database. 36 of 36 checks passed on the final run.
- **HR, with the browser set to New York:** add a missing record at 09:30, correct it to 08:55.
  LATE became PRESENT, the stored times were right in UTC, and the history and Alex's notification
  were right. HR's own record was blocked. A night-shift override showed on the employee page and in
  `/schedule/me`. Visit detail, map link and visit correction worked, and a future check-out was refused.
- **Company Admin:** sees positions.
- **Manager:** team only, no Details, Correct or Add buttons, and no API response carried a coordinate.
- **Employee:** the notification opens their own record, with no Correct button.
- **Console:** no errors after login, apart from the one 400 the script provoked on purpose.

Earlier runs failed because of the script, not the app: it used a check-out time still in the
future, which the API rightly refused, and it hit the login rate limit. I fixed the script, and
reset only the test database between runs.

My first attempt to stop the temporary API left its process running. I then stopped my temporary
servers by the PIDs listening on 4001 and 5199, and removed the temporary Vite config. Nothing on
4000 or 5173 was stopped or started. `/api/v1/health` on 4000 answered 200 at the end.

## Dev database check
Row counts of all tables, from before the migration to the end of the work:

| Table | Before | After | Why |
|---|---|---|---|
| `_prisma_migrations` | 10 | 11 | This step's migration |
| `employee_schedules` | none | 0 | New table, empty |
| `attendance_corrections` | none | 0 | New table, empty |
| The other 18 tables | same | same | |

No reset and no reseed.

## Your checklist
**First: stop `pnpm dev`, run this while it's stopped, then start it again.**
```
pnpm --filter @employee-saas/api db:generate
```
Reload the app in Expo. There's no new native library, so nothing else is needed.

**Know your dev data (2026-11-06):** Alex, Jordan and Taylor each have a `LATE` record today. Alex
and Jordan have checked out, and Taylor hasn't. Everything below works on today's records, or on
tomorrow's if you test then.

**The answers to your 2.5 questions:**
1. Phone, as any employee: Home → Check in at a site → tap a site. "Check in at X?" appears. Cancel:
   nothing happens. Check in: it goes through. At a GPS site, the message also mentions location.
2. Web as HR, Site visits: **Details** on a visit shows both positions, accuracy and a Google Maps
   link that opens the right place. A site with no GPS says no position was recorded.
3. Web as `admin@acme.test`: the same. As `manager@acme.test`: no Details button anywhere.

**The plan's "Try it":**
4. Web as HR, **Attendance**: today's date, with Alex's row showing `LATE`.
5. Details → **Correct**, change the check-in to 08:55, reason "Forgot to tap on arrival". LATE
   becomes PRESENT and the history shows it. On the phone as Alex, the bell shows the notification,
   and tapping it opens the Attendance tab, where the day says "Corrected by HR".
6. Web, employee page for Alex → **Set own schedule**, 22:00 to 06:00. Phone as Alex, Attendance tab:
   My schedule says "Your own working hours" and "22:00 - 06:00 (next day)".
7. **Night shift for real (optional, late evening):** with that override, check in around 22:00, and
   check out after midnight or the next morning. It's one record, on the date it started. Alex already
   has a record today, so try it on a day he doesn't.
8. **Remove the override afterwards** (**Use company hours**), or Alex stays on nights.
9. As HR, open your own record if you have one: no Correct button, and a message says to ask someone
   else. If you don't have one, skip this: the API tests cover it, and the real-browser check did too.

**Also worth trying:**
10. **Add missing record:** for someone with no record yesterday. A second try for the same day says
    one exists and offers to open it.
11. **Correct a visit:** Details → Correct times. Add a check-out to an open visit, and it closes.
12. **Manager:** Attendance shows only the team, with no Add or Correct, and no positions on the record
    page. The employee page shows the Schedule section with no edit buttons.
13. **Other PC timezone (the plan's risk):** set Windows to UTC, and repeat step 5 on another day. The
    boxes still show company time. I tested this with the browser set to New York, not with the PC changed.
14. **Module off:** untick Attendance for ACME. The menu item goes, and the Schedule section too. Tick it
    again afterwards.

To see the rows, in PowerShell:
```
docker exec employee-saas-postgres-1 psql -U employee_saas -d employee_saas -c 'SELECT c.\"createdAt\", c.reason, c.before, c.after FROM attendance_corrections c ORDER BY c.\"createdAt\" DESC LIMIT 5;'
```

## Known limitations
- **`prisma generate` couldn't finish**, as in earlier steps: the engine file is locked by your running
  dev API. The client code did update, and tests ran on it. The command above finishes it cleanly.
- **Your dev API restarted itself during my edits**, because `tsx watch` saw them. I never restarted it.
- **The mobile changes have only run in tests,** including the confirmation and My schedule.
- **I didn't measure the new pages at phone width.** I meant to, but stopped the servers first. They use
  the same shell as the rest, so expect the sideways scroll now in the backlog.
- **I didn't build each suggested commit on its own.** I checked by hand which files each one needs.
  Only the full set has been typechecked and tested.
- **Attendance shows only rows that exist.** Someone who hasn't checked in doesn't appear until step 2.7
  writes `ABSENT` and step 2.11 adds the daily report. "Add missing record" is the way in until then.
- **Add missing record lists the first 100 active employees,** like the Phase 1 manager dropdown.
- **The correction history shows times without dates,** so a night shift's check-out reads as "06:30"
  with no day.
- **Leave day counts still use the company's working days,** not an employee's override. Leave is
  unchanged by this step.
- **There's no audit screen,** so `SCHEDULE_UPDATED` and the corrections are in the table only. The
  permissions doc mentions an HR audit filter, but no audit endpoint exists yet.
- **A correction notification's body holds the reason.** Step 2.9's push must use a safe lock-screen text
  for it, as the design already says for HR notes.

## Questions for you
1. **Should HR be able to set their own schedule?** It's allowed and audited, but HR could move their own
   start time to avoid being late. The alternative is to block it like self-correction. I recommend
   blocking it, as it's one check, but the design doesn't ask for it, so I left it.
2. **Should the manager see the correction reason?** They do now. A reason could mention something
   personal, like a medical appointment. I recommend keeping it, since the manager is responsible for the
   team's attendance, and telling HR to write reasons accordingly.

## Exact next step
Run the checklist and answer the two questions. After that, **step 2.7 Job runner + day close**.
