# Step 2.5 Report: Site visits + manager notification

Plan: `docs/phase2/plan.md` → 2.5. Checklist: `docs/reports/step-2.5-progress.md`.

**Status: code complete. Typecheck and lint pass, and all 1269 tests pass. The API and the
web page also ran for real against the test database, in real Chromium. The mobile screens
have only run in tests, with a fake GPS and a fake server, and not on a phone. That's your
checklist below.**

## What was done

### Shared
- `siteVisits.ts`: statuses, flags, request, list and response schemas.
- `SITE_CHECKED_IN` notification type.
- `openVisit` on the today response.

### Database (`20261106180000_phase2_site_visits`)
- The `site_visits` table and the `SiteVisitStatus` enum.
- Hand-written: the partial unique index for "one open visit", the GPS purge index, and
  4 CHECKs.
- **Freeze check:** no `ALTER TABLE` on `companies`, `users` or `refresh_tokens`.
- **Back-relation lines added (no SQL):** `Company.siteVisits`. Also, on tables that aren't
  frozen, `Employee.siteVisits`, `Site.visits` and `AttendanceRecord.siteVisits`. Nothing on
  `User`.

### API
Seven endpoints behind `requireModule("sites")`: check-in, check-out, my visits, my open
visit, team, all, and one visit.

| Situation at site check-in | Attendance record | Visit |
|---|---|---|
| No record yet | **Created**, `source = SITE_VISIT`, lateness judged normally | Linked |
| Checked in, still open | Unchanged | Linked |
| Checked out, past its close time, or auto-closed | Unchanged | Linked, **`AFTER_HOURS`** |
| `ON_LEAVE` or `HOLIDAY` row from day close | Unchanged | Linked, **`AFTER_HOURS`** |
| **`ABSENT` row** | **Unchanged** | Linked, **`ON_ABSENT_DAY`**, not `AFTER_HOURS` |
| Past the close time with no row | None created | Not linked, **`AFTER_HOURS`** |
| `attendance` module off | Not touched | Not linked, no flag |

The manager gets `SITE_CHECKED_IN` in every row above, in the same transaction as the visit.

Also:
- **GPS:** the same `gpsVerification.ts` rules as the office, with the chosen site. Check-in
  can refuse. Check-out only flags. A location for a site that doesn't require GPS never
  reaches a column.
- **One open visit:** the database enforces it, so two simultaneous taps give one visit and
  one `VISIT_ALREADY_OPEN`.
- **Day check-out** closes an open visit at the same instant, in the same transaction.
- **Managers never get coordinates.** Lists have none for anyone.
- `GET /attendance/:id` now also returns that day's visits, as the API doc planned.

### Mobile
- **Home, Site visit card:** "Check in at a site", or a banner with the site, the start time
  and a running timer, plus "Check out of site" and "My visits". It shows whenever `sites` is
  on, even with `attendance` off.
- **Site picker:** search on the server, external sites only.
- **My visits:** an infinite list, which explains `AFTER_HOURS` and `ON_ABSENT_DAY` in words.
- **Day check-out confirmation:** adds "This also checks you out of X." when a visit is open.
- **`useLocationGate`:** the disclosure moved out of `AttendanceCard` into a hook, so all three
  buttons that read location go through the same step.

### Web
- **Site visits page** for managers (their team), HR and Company Admin (everyone): "On site
  now", then history with date and site filters, refreshing every 60 s.
- Flags appear in plain words. Opening the notification goes to this page.

## Decisions the design didn't cover
Please check these. All are in the docs, and all are easy to change now.

| Situation | What I did | Why |
|---|---|---|
| **Past the close time, with no row** (§1.6 only covers a record that exists) | `AFTER_HOURS`, not linked, no row created | An office check-in then would be refused, so a visit shouldn't start the day either. **This leaves work for 2.7: see below.** |
| **`clientRequestId` uniqueness** | Per employee. The schema doc said per company. | The same reason you accepted in 2.3: one employee's id must never find or block another's row. |
| **An office picked as a visit's site** | 404, the same as an unknown site | §2 says employees pick external sites. The picker hides offices, but the API has to enforce it. |
| **Day check-out, office and visit site with different GPS settings** | Each is judged by its own site, from the one location | Q6: a location is only kept where a site requires it. |
| **Which taps read the location** | `gpsRequired` is true before a check-out if the office **or** the open visit's site requires it | Otherwise a day check-out could never record the visit's location. |
| **`sites` switched off with a visit open** | A day check-out still closes it, keeping no position | Nothing else could close it then. |
| **A note at check-out** | Added to the check-in's note on a new line | The table has one `note` column, and overwriting would lose the first. The app doesn't offer notes yet. |
| **`/site-visits/me/open` response** | `{ visit, gpsRequired }`, not just the visit | The app needs to know whether check-out should read the location, and employees aren't given site details on a visit. |
| **No "Are you sure?" on site check-out** | Left out | You can start another visit, so a mistake is cheap, unlike the day check-out. |
| **A manager tapping the notification on the phone** | Marks it read and stays put | The plan puts the manager's page on web only. |

**Left for later, as the design says:** "sites from my tasks first" comes with tasks in 2.10,
and `PATCH /site-visits/:id/correct` comes with corrections in 2.6.

**Added to step 2.7 in the plan:**
- A visit opened after the day closed, or with attendance off, has no later day close to end
  it. Open visits need their own rule. I suggested check-in + 16 hours.
- If day close writes `ABSENT` for a date with an unlinked `AFTER_HOURS` visit, it must link
  the visit and change the flag to `ON_ABSENT_DAY`. Otherwise HR's report misses it.

## New concepts (plain language)
- **Partial unique index:** a uniqueness rule that only applies to some rows. Here,
  "per employee, unique among rows where status is OPEN". That allows any number of closed
  visits but only one open one, however many requests arrive at once.
- **Retrying after losing a race:** a site check-in and an office check-in can both see "no
  record today". One insert fails. The transaction undoes that attempt, and the code looks
  again, finds the row, and records only the visit.
- **`satisfies` and `GetPayload`:** `VISIT_INCLUDE` lists what every visit query fetches, and
  Prisma works out the row's type from it, so the DTO code can't read a field that wasn't
  loaded.

## Files changed
**Shared**
- `packages/shared/src/attendance.ts`, `index.ts`, `notifications.ts`
- New: `packages/shared/src/siteVisits.ts`, `siteVisits.test.ts`

**API**
- `apps/api/prisma/schema.prisma`
- New: `apps/api/prisma/migrations/20261106180000_phase2_site_visits/migration.sql`
- `apps/api/src/app.ts`, `lib/gpsVerification.ts`, `lib/tenantPrisma.ts`
- `apps/api/src/modules/attendance/attendance.routes.ts`, `attendance.service.ts`,
  `attendance.test.ts`
- New: `apps/api/src/lib/ownEmployee.ts`
- New: `apps/api/src/modules/siteVisits/siteVisits.routes.ts`, `siteVisits.service.ts`,
  `siteVisits.rules.ts`, `siteVisits.rules.test.ts`, `siteVisitRows.ts`, `siteVisits.test.ts`

**Mobile**
- `apps/mobile/src/strings.ts`, `app/_layout.tsx`, `app/(tabs)/index.tsx`,
  `components/AttendanceCard.tsx`, `lib/attendance.ts`
- `apps/mobile/src/__tests__/app/home.test.tsx`, `__tests__/components/AttendanceCard.test.tsx`
- New: `apps/mobile/src/app/site-picker.tsx`, `app/my-visits.tsx`,
  `components/SiteVisitCard.tsx`, `components/useLocationGate.tsx`, `lib/siteVisits.ts`,
  `lib/siteVisits.test.ts`, `__tests__/app/site-picker.test.tsx`, `__tests__/app/my-visits.test.tsx`,
  `__tests__/components/SiteVisitCard.test.tsx`

**Web**
- `apps/web/src/App.tsx`, `strings.ts`, `lib/navigation.ts`, `lib/navigation.test.ts`,
  `lib/useOpenNotification.ts`, `routes/NotificationsPage.test.tsx`
- New: `apps/web/src/routes/SiteVisitsPage.tsx`, `SiteVisitsPage.test.tsx`

**Docs**
- `docs/phase2/plan.md`, `architecture-phase2.md`, `api-phase2.md`, `database-schema-phase2.md`
- New: `docs/reports/step-2.5.md`, `step-2.5-progress.md`

**No new libraries**, so nothing was installed with `npx expo install`.

## Commands run
```
prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script
pnpm run db:migrate:test           test DB
prisma migrate deploy              dev DB
prisma generate                    FAILED on a file lock (see Known limitations)
tsx prisma/seed.ts                 test DB only, for the real-server check
pnpm typecheck                     exit 0
pnpm lint                          exit 0
pnpm test                          exit 0, API part 287 s
```

## Test results
| Workspace | Before (step 2.4) | Now |
|---|---|---|
| shared | 278 | 291 |
| api | 593 | 741 |
| mobile | 96 | 141 |
| web | 73 | 96 |
| **Total** | **1040** | **1269** |

**Real servers and real browser:** a throwaway script, not in the repo, using a temporary API
on port 4001 and Vite on 5199, on the **test** database. 30 of 31 checks passed.
- **Over real HTTP:** GPS refusals, check-in, retry, double check-in, the day starting from a
  visit, check-out with a flag, day check-out closing a visit, `AFTER_HOURS`.
- **In real Chromium:** the manager's notification opens the page, "on site now", history, the
  HR view, and an employee sent to Not allowed. No coordinates on the manager's page, and no
  console errors after login on the manager's or HR's page.
- **The one failure: the page scrolls sideways at phone width (509 px).** It isn't specific to
  this page. The app shell's sidebar has no narrow layout, so existing pages do it too:
  `/sites` 571 px, `/leave-requests` 218 px, `/employees` 185 px, the dashboard 70 px. I didn't
  change the shell. See Known limitations.

I stopped my two servers by the PIDs I'd recorded, and removed the temporary Vite config. I
didn't stop or start anything on 4000 or 5173. `/api/v1/health` on 4000 answered 200 at the end.

## Dev database check
Row counts of all tables, from before the migration to the end of the work:

| Table | Before | After | Why |
|---|---|---|---|
| `_prisma_migrations` | 9 | 10 | This step's migration |
| `site_visits` | none | 0 | New table, empty |
| `refresh_tokens` | 55 | 57 | **Not from my commands:** all my servers and tests used the test database. The new rows were created at 10:10 and 10:32 UTC, and the earlier one shows as replaced, which looks like a logged-in session on your dev API refreshing. I didn't confirm which one. |
| The other 16 tables | same | same | |

No reset and no reseed.

## Your checklist
**First: stop `pnpm dev`, run this while it's stopped, then start it again.** See "Known
limitations" for why.
```
pnpm --filter @employee-saas/api db:generate
```
Reload the app in Expo. There's no new native library, so nothing else is needed.

**Know your dev data today (2026-11-06):**
- ACME has **no external site yet**, only offices. Step 1 creates one.
- **Alex and Jordan have already checked out today**, so any visit they make today is
  `AFTER_HOURS`. That's a useful test, but it isn't the "starts the day" test.
- **Taylor has no record today**, so use `taylor@acme.test` for the first steps. After 21:00
  Taylor's day has closed too, and a visit is `AFTER_HOURS` with no link. If that happens, use
  Taylor or Alex tomorrow.
- All three report to `manager@acme.test`. Both `hr@` and `manager@` have no manager, so their
  own visits notify nobody.

**The plan's "Try it":**
1. On web as HR, Sites → New site: `EXTERNAL`, near where you are, GPS required, 200 m.
2. Phone as Taylor. Home has a **Site visit** card. Tap **Check in at a site**: the picker lists
   your external site, with no offices. Search for it.
3. Tap the site: you go back to Home, with a green banner, "Since" and a timer. The Attendance
   card now offers **Check out**, because the visit started the day.
4. Web as `manager@acme.test`: the bell shows "... checked in at ..., 16:xx" within 60 s.
   Opening it goes to **Site visits**, with Taylor under "On site now", the distance, and no
   coordinates. HR's page shows the same visit.
5. The timer moves on: wait a minute or two, and it updates without a refresh.
6. On the phone, **Check out of site**: the banner goes. **My visits** and the web history both
   show the duration. The Attendance card still offers Check out: the day isn't over.
7. **Second check-in while one is open (optional, needs two phones):** Home hides the button
   while a visit is open, so one phone can't normally reach this. Log in as Taylor on both, and
   open the picker on the second. Check in on the first, then tap a site on the second: "Check
   out of X first." The API and the phone's message are both covered by tests.

To see the rows at any point, in PowerShell:
```
docker exec employee-saas-postgres-1 psql -U employee_saas -d employee_saas -c 'SELECT u.email, s.name, v.status, v.flags, v.\"durationMinutes\", v.\"attendanceRecordId\" IS NOT NULL AS linked FROM site_visits v JOIN sites s ON s.id = v.\"siteId\" JOIN users u ON u.\"employeeId\" = v.\"employeeId\" ORDER BY v.\"createdAt\";'
```

**GPS:**
8. Away from the site, with the site's coordinates somewhere else: "You are 12.3 km from ..."
   and the picker stays open. Check the Home card: nothing was recorded.
9. Check in near the site, walk away or edit its coordinates on web, then check out: it goes
   through, and web shows **Outside at check-out**.
10. A site with GPS required off: no location prompt and no position stored.

**Day check-out:**
11. With a visit open, tap the Attendance card's **Check out**: "Are you sure" also says "This
    also checks you out of ...". Confirm: the banner goes, and the query above shows the
    visit `CLOSED`.

**The two flags:**
12. **`AFTER_HOURS`:** as Alex, today, check in at the site. It works. My visits says "After
    hours", web shows the flag, and the manager is still notified. Alex's attendance row doesn't
    change.
13. **`ON_ABSENT_DAY` (optional):** nothing writes `ABSENT` until 2.7, so this needs a row added
    by hand to your **dev** database. Skip it if you'd rather not: the tests cover it. As HR,
    who has no record today (use today's date, and do this before HR checks in):
    ```
    docker exec employee-saas-postgres-1 psql -U employee_saas -d employee_saas -c "INSERT INTO attendance_records (id, \"companyId\", \"employeeId\", \"workDate\", status, source, \"updatedAt\") SELECT gen_random_uuid()::text, u.\"companyId\", u.\"employeeId\", DATE '2026-11-06', 'ABSENT', 'SYSTEM', now() FROM users u WHERE u.email = 'hr@acme.test';"
    ```
    Then on the phone as `hr@acme.test`: the Attendance card says the day has closed. Check in at
    the site: it works, My visits says the day was marked absent, and web shows **On a day marked
    absent**. The row stays `ABSENT`. The row and that visit stay in your dev data, and HR can
    correct it from 2.6.

**Module off:**
14. Log in as a BETA employee: no card. Or untick Sites for ACME on web, pull down on Home (the
    settings can take up to a minute), then tick it again. The web menu item goes too.

## Known limitations
- **`prisma generate` couldn't finish**, as in 2.2 and 2.3: the engine file was locked by your
  running dev API. The client code did update, and the tests and temporary API ran on it. The
  engine file itself is unchanged. The command above finishes it cleanly.
- **Your dev API restarted itself during my edits**, because `tsx watch` saw them. It was
  answering 200 at the end, and I never restarted it.
- **The mobile screens have only run in tests.** That includes the picker, the banner, real GPS
  and the look of Home with two cards.
- **Nothing closes a forgotten visit until 2.7.** It blocks the next visit until the employee
  checks out, and the next day check-out will close it. Either way, the duration will be long.
- **`mocked` hasn't been tried at a site with a real fake-GPS app.** It's the same code as the
  office, which you tested.
- **The web portal has no narrow layout**, on any page (see the real-server check). This page's
  tables scroll inside their cards, but the whole page also scrolls sideways.
- **Web "on site now" shows up to 100 people**, though its heading counts them all. The site
  filter lists up to 100 sites.
- **A retry after a lost site check-out response** gets `VISIT_NOT_OPEN`, as with the day
  check-out in 2.3. The card refreshes to the right state, and the message is accurate.
- **The employee doesn't see GPS flags** in My visits, only the two day flags. HR and managers do.

## Questions for you
1. **Should the picker tap ask "Check in at X?" first?** It checks in straight away, which is
   what the plan describes, but one mistaken tap starts the day and notifies the manager. I
   recommend trying it on the phone first, since the plan called for a design pass there.
2. **Is `AFTER_HOURS` with no link right for a visit past the close time with no row?** The
   alternative is to create a row, but then 2.7's `ABSENT` logic would conflict with it. I
   recommend keeping it.

## Exact next step
Run the checklist and answer the two questions. After that, **step 2.6 HR attendance views,
corrections, schedule overrides**.
