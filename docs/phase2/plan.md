# Phase 2 plan — Attendance & Site Management

**Status: approved. All open questions were resolved by the developer on
2026-11-03 (see "Resolved questions" at the end).** Steps 2.1 to 2.5 are
implemented and tested on a device (`docs/reports/step-2.1.md` to `step-2.5.md`). Step 2.6
is implemented and awaiting its checklist (`docs/reports/step-2.6.md`).

Design: `database-schema-phase2.md`, `api-phase2.md`,
`permissions-phase2.md`, `architecture-phase2.md` (all in `docs/phase2/`).

**Every step**, like Phase 1:
- Update the docs if the design changes.
- Add migrations with `prisma migrate diff` (never a reset), and apply them
  to dev and test.
- Add cross-tenant 404 tests for every new table/endpoint, and
  `MODULE_DISABLED` tests for every gated router.
- Run typecheck, lint and the full `pnpm test`.
- Write a report in `docs/reports/step-2.X.md` and a real-device checklist.
- Never commit.

Each step is sized for one or two sessions.

The order is chosen so that **every step ends with something you can try**,
and the riskiest unknowns come early:
- the EAS dev build: you can start its accounts during 2.3;
- the time maths: 2.1;
- GPS on a real phone: 2.4.

---

## 2.1 Foundations: module switches, schedule settings, shared helpers
**Scope**
- `requireModule()` middleware, with 403 `MODULE_DISABLED`.
- Shared `isModuleEnabled()`.
- `company_settings` new columns (migration) and the shared schema update.
- Web **Company Admin → Settings**: module switches (attendance / sites /
  tasks), default working hours, grace, auto-checkout, reminders, GPS
  accuracy/retention.
- Shared helpers, with tests under both TZs plus a DST zone:
  - `zonedDateTimeToUtc`
  - `getWorkDate` (the work-date rule)
  - `haversineMeters`
  - `getNotificationTarget` (replaces `getNotificationLeaveRequestId` in
    web and mobile, with no behaviour change)
- `notifications.dedupeKey` column + partial unique index.
- Pino redaction for location fields.
- **Seed** (Q1): `seedCompany` sets `enabledModules` to `{ attendance:
  true, sites: true, tasks: true }` for ACME and leaves BETA at `{}` (all
  off), when it first creates the settings row.
  - **The dev DB is not reseeded** (your decision, 2026-11-06; it holds your
    real-device test data). Tests use their own fixtures.

**Try it:**
- Web as Company Admin: toggle modules and change working hours, save,
  reload, and the values persist.
- Audit log shows `COMPANY_SETTINGS_UPDATED`.
- Existing leave notifications still open the right screen on web and
  phone.

**Risks:**
- Getting the timezone/DST helper right without a library. It's mitigated
  by table-driven tests, including a night shift and the London DST change.
- Your current dev DB's ACME still has `enabledModules: {}`, so its
  modules are off until you switch them on in the new settings page (your
  decision, 2026-11-06: no reseed).

## 2.2 Sites (API + web)
**Scope**
- `sites` table.
- CRUD, deactivate and delete-if-unused endpoints.
- Audit entries.
- Web **Sites** page (HR / Company Admin): list with filters, create/edit
  form with lat/lng inputs, an "Open in Google Maps" check link, and
  defaults from settings.
- Cross-tenant and module tests.
- **Settings fixes found in 2.1:**
  - `gpsRadiusMeters` must be 25–5000, the same as a site's radius, so a bad
    default can't make site creation fail.
  - The Settings page gets the two fields it was missing: default GPS radius
    and "GPS required for new sites".
  - The 1–16 hour shift rule also applies to the company default hours (your
    decision, 2026-11-06).

**Try it:**
- On web, create your real office as an `OFFICE` site: copy the coordinates
  from Google Maps, set the radius to 200 m and GPS required on. Also create
  one `EXTERNAL` site somewhere near your home.
- Deactivate one; it disappears from the employee list (check with
  `GET /sites` as Alex, or wait for 2.5's picker).

**Risks:**
- Low. The main one is lat/lng entered in the wrong order. The map link
  makes that visible.

## 2.3 Office attendance: check-in / check-out (no GPS yet)
**Scope**
- `attendance_records`.
- `/attendance/me/today`, check-in, check-out, `/attendance/me`,
  `/attendance/:id`.
- Status/lateness/worked-minutes rules, the work-date rule and the edge-case
  409s (double check-in, check-out without check-in).
- `clientRequestId` retry handling.
- Concurrency test: two simultaneous check-ins → one row.
- **Mobile:**
  - Home gets an "Attendance" card: today's schedule, a big Check in /
    Check out button, times so far, and a "Late by 12 min" chip.
  - New **Attendance** tab with my history (infinite list).
  - Online only (Q4): with no connection the app shows **"No internet
    connection, try again"** and queues nothing.

**Try it:**
- Phone (Alex): check in. The card shows the time and PRESENT or LATE,
  depending on the time vs 09:00 + 10 min.
- Tap again: the button now says Check out.
- Check out: worked hours appear.
- Airplane mode + tap: "No internet connection, try again", and nothing
  is recorded.
- Web as HR: nothing yet (the HR views come in 2.6). The API log shows the
  rows.

**Developer side task:** create the Expo account and Firebase project now
(architecture §4.7, steps 1–4). It takes calendar time, not code time.

**Risks:**
- The night-shift work-date logic. It's covered by unit tests here, and
  you can try it on the phone in 2.6, once schedule overrides exist.

## 2.4 GPS verification + privacy disclosure
**Scope**
- `expo-location` (approved, Q23: `npx expo install expo-location`).
  Foreground permission only, and
  the plugin config removes the background permission.
- Disclosure screen before the first permission prompt.
- **Profile → Location & privacy** screen.
- Server GPS rules (architecture §3.2): reject vs flag, and the audit row on
  a mock rejection.
- Nearest-office selection, which fills `checkInSiteId`, the `NO_OFFICE_SITE`
  flag, and `gpsRequired` + office site in `/attendance/me/today` (left out of 2.3,
  which has no GPS).
- Unit tests for every row of the §3.2 table.
- An Android manifest check: `npx expo export` or `npx expo config --type
  introspect` shows no `ACCESS_BACKGROUND_LOCATION`.
- `expo-location` works in **Expo Go**, so no dev build is needed yet.

**Try it:**
1. At home, with the office site set to GPS required: check in → "You are
   12.3 km from Head Office", rejected.
2. Temporarily edit the office site's coordinates to your home on web →
   check in works, `withinRadius` ✓.
3. Indoors with poor GPS, the check-in goes through with a "low accuracy"
   flag (visible in the 2.6 HR view; until then, in the API response).
4. Deny location permission → a clear message and a link to settings.
5. **Mock test** (optional): Developer options → *Select mock location
   app* → a free "Fake GPS" app → check-in rejected, with an audit log row.

**Risks:**
- Real-world GPS accuracy indoors. The thresholds are settings, so they're
  tunable without code.
- Whether expo-location reports `mocked` with the fake-GPS app you pick.
  That's verified on your phone in this step.

## 2.5 Site visits + manager notification
**Scope**
- `site_visits`.
- Check-in/out with site GPS rules.
- The first visit starts the attendance day (§1.6).
- A visit after the day is closed doesn't reopen it and is flagged
  `AFTER_HOURS`.
- A visit on a day already marked `ABSENT` leaves the row alone and is flagged
  `ON_ABSENT_DAY` (your decision, 2026-11-06).
- One open visit at a time.
- Day check-out closes an open visit.
- `SITE_CHECKED_IN` notification to the manager.
- Team/HR list endpoints.
- **Mobile:**
  - "Check in at a site" on Home → site picker (search, sites from my tasks
    first) → an open-visit banner with a timer → Check out.
  - "My visits" list.
- **Web** (manager + HR): **Site visits** page, with "on site now" and
  history.

**Try it:**
- Phone (Alex): check in at the external site near home. On web the
  manager's bell gets "Alex checked in at …" within 60 s.
- Check out → the duration appears on phone and web.
- Try a second check-in while one is open → "Check out of X first". Home hides the
  button while a visit is open, so this needs the picker already open on a second phone.

**Risks:**
- The UX of "day check-in" vs "site check-in" on one Home screen. We'll do
  a quick design pass on the phone before polishing it.

## 2.6 HR attendance views, corrections, schedule overrides
**Scope**
- Web **Attendance** page:
  - HR: daily view with status chips and flags, including an `ABSENT` row
    that has an `ON_ABSENT_DAY` visit, so HR can correct it;
  - manager: team-only;
  - record detail with visits and correction history.
- Correct-record and create-missing-record dialogs (reason required).
- `attendance_corrections` + audit, and self-correction blocked.
- Site visit correction.
- `employee_schedules` + web "Schedule" section on the employee page.
- `/schedule/me` + a mobile "My schedule" (next 14 days) on the Attendance
  tab.
- `ATTENDANCE_CORRECTED` notification.

**Try it:**
- Web as HR: open today, find Alex, and correct the check-in to 08:55 with
  the reason "Forgot to tap on arrival". LATE becomes PRESENT, the history
  shows it, and Alex gets a notification.
- Give Alex a night-shift override (22:00–06:00). The phone's schedule
  shows it.
- Try correcting HR's own record as HR → blocked.

**Risks:**
- Web date/time inputs in company time vs browser time. Reuse the 1.7
  helpers, and test with the PC timezone set to UTC.

**Added before this step (your decisions, 2026-11-06):**
- A "Check in at <site>?" confirmation in the site picker, because a check-in notifies the
  manager and can record the location.
- A visit detail on the web Site visits page, for HR and Company Admin only: both positions,
  accuracy and an "Open in Google Maps" link (Q7). Managers have no way in.
- A visit past the close time with no row stays unlinked `AFTER_HOURS`, with no row
  created. Confirmed, so step 2.7's linking plan stands.

## 2.7 Job runner + day close (auto-close + absent marking)
**Scope**
- `job_runs`.
- `apps/api/src/worker.ts` with the tick loop, the claim logic and stuck-run
  recovery. `pnpm dev` starts it.
- `attendance.dayClose`: auto-close → INCOMPLETE + notify; absent /
  on-leave / holiday rows.
- Cross-module hooks: leave approve/revoke/cancel and holiday add/delete
  flip past rows.
- Deactivating an employee closes their open record as `INCOMPLETE` +
  `AUTO_CLOSED` (architecture §1.5). It uses the same closing code, so it waits for
  this step rather than 2.3.
- Auto-close must also cover a check-in with no schedule (a holiday or weekly off),
  whose `scheduledEndAt` is NULL: its close time is check-in + 16 hours
  (architecture §1.3). The partial index on `scheduledEndAt` alone won't find it.
- **Found in 2.5, two things about site visits:**
  - Closing a day's record doesn't reach every open visit. A visit opened after the
    day closed (`AFTER_HOURS`), or with attendance off, has no later day close to end
    it, so open visits need their own rule. Suggested: check-in + 16 hours, like a
    check-in with no schedule.
  - A visit made after the close time, before day close has written the day's row, is
    `AFTER_HOURS` with no `attendanceRecordId` (architecture §1.6). If day close then
    writes `ABSENT` for that date, it must link those visits and change the flag to
    `ON_ABSENT_DAY`, or HR's daily report won't show the contradiction.
- `/health` worker status.
- Fake-clock tests for Colombo and a night shift, and a two-workers test.

**Try it:**
1. Set the company's auto-checkout to 30 min and your schedule end to now
   − 25 min.
2. Check in on the phone and don't check out.
3. About 5 min later, the record is INCOMPLETE and the phone shows "You
   didn't check out".
4. The next morning, the web daily view shows employees who never checked
   in as ABSENT. Approve a sick leave for one of them for yesterday → it
   flips to ON_LEAVE.
5. Run `pnpm dev` twice (two workers) and confirm only one notification.

**Risks:**
- This is the most logic-heavy step. It may need two sessions: runner +
  auto-close first, then absent marking + hooks.
- Choosing the day-close query shape so it stays cheap for big companies.

## 2.8 Reminders and housekeeping jobs
**Scope**
- `attendance.checkinReminder`, `leave.proofDueTomorrow`,
  `leave.proofOverdue`, all deduplicated by `dedupeKey`.
- `gps.purge` and `housekeeping`.
- Settings switches respected.

**Try it:**
- Set your schedule start to 5 minutes from now and don't check in → an
  in-app reminder arrives at start time (as push after 2.9).
- Submit a sick leave starting yesterday with a 2-day deadline and no proof
  → Alex gets "due tomorrow" at the daily reminder time (set it to a few
  minutes from now for the test).
- One day later, HR gets "overdue". It's sent once only.

**Risks:**
- Low, given 2.7's runner. The main risk is reminder noise, so each
  reminder type has a switch.

## 2.9 Push notifications
**2.9a — Dev build only, no push code.**
- Scope:
  - add `expo-dev-client` (approved, Q23: `npx expo install
    expo-dev-client`) + `eas.json`;
  - `npx eas-cli build --profile development --platform android`;
  - install it on your phone and run the app from it.
  - Fix whatever the pnpm monorepo needs for EAS (hoisting, `.npmrc`, the
    lockfile).
- Try it: the app runs from your own dev build exactly as in Expo Go.
- **Risk: highest of the phase.** EAS + a pnpm workspace + our React 18/19
  hoist rules. That's why it's isolated.

**2.9b — Push.**
- Scope:
  - `push_devices`, `user_notification_settings`, `push_messages` (outbox);
  - `createNotification` fan-out;
  - `push.send` (immediate kick + 30 s sweep) and `push.receipts`;
  - device disable on `DeviceNotRegistered`;
  - safe lock-screen bodies;
  - register on login/start, unregister on logout;
  - tap-to-open (warm and cold start);
  - **Profile → Notifications** opt-out screen;
  - `.env.example` gets `EXPO_ACCESS_TOKEN`.
  - Libraries (approved, Q21/Q23):
    - API: `expo-server-sdk`, behind our `PushSender` interface;
    - mobile: `npx expo install expo-notifications expo-device`.
- API tests use a fake `PushSender`. There are no real network calls in
  tests.
- Try it: the full checklist in architecture §4.7 step 9.
- Risks:
  - FCM credential setup mistakes. The receipt job logs them clearly as a
    config problem.

## 2.10 Tasks
**Scope**
- `tasks` table and endpoints, with the manager/team and assignee-status
  rules.
- `TASK_ASSIGNED` and `TASK_COMPLETED` notifications (in-app + push).
- **Web:** Tasks page (manager: my team's tasks + create; HR: all).
- **Mobile:** a **Tasks** section (on the Attendance tab, or its own tab;
  you decide on the phone) with a status switcher. A task with a site
  offers "Check in at this site".

**Try it:**
- Web as the manager: assign "Inspect Site X" to Alex for tomorrow. The
  phone gets a push.
- Alex sets it to In progress, then Done. The manager is notified when it's
  Done.
- As the manager, try assigning to someone not on your team → not offered,
  and the API rejects it with 404.

**Risks:**
- Low. Scope creep (priorities, comments, attachments) is deliberately
  out.

## 2.11 Reports, CSV export, dashboard tiles
**Scope**
- Daily, monthly and site-visit report endpoints + CSV export (BOM,
  formula-injection guard, no coordinates, audited). The daily report and its
  CSV show `ON_ABSENT_DAY` visits next to the `ABSENT` row.
- Web **Reports** page with three tabs and "Download CSV".
- Dashboard tiles for today's attendance, on site now, and open/overdue
  tasks.

**Try it:**
- Web as HR: export this month's summary and open it in Excel. Names,
  totals and local times are correct.
- As the manager, only the team appears.
- Put an employee's name as `=1+1` in a test company → it shows as text in
  Excel.

**Risks:**
- Report query speed on a big month. Check it with `EXPLAIN` against the
  indexes in the schema doc.

## 2.12 Phase 2 hardening and close
**Scope**
- A sweep of cross-tenant tests over every Phase 2 endpoint.
- `MODULE_DISABLED` tests on every router.
- A review of the logs for coordinates/tokens.
- The seed gains demo sites/attendance for **demo mode only**, run only
  with your permission (CLAUDE.md #10).
- README: worker, dev build and push setup.
- Update `docs/architecture.md`/`database-schema.md` to point at the phase 2
  docs, and update the CLAUDE.md status.
- A full real-device regression (leave + attendance + sites + tasks +
  push).

**Try it:**
- The full checklist end to end on your phone and web, with the BETA
  company proving isolation (BETA's HR sees none of ACME's sites or
  attendance).

---

## UX improvements backlog
Small improvements that aren't part of any step yet. Pick them up when a step
touches the same screen, or schedule them on their own.
- **Inline image preview of proof documents:** HR sees the proof image on the
  leave request detail page, without having to open it separately.
- **Paste coordinates into one box:** paste "lat, lng" from Google Maps into one
  box on the site form, and it fills both the latitude and longitude fields.
- **Web portal scrolls sideways at phone width (app shell sidebar):** the sidebar has no
  narrow layout, so every page does it (measured in step 2.5).

---

## Resolved questions
All 24 were resolved by the developer on 2026-11-03.
- **Your answer:** the decision you gave explicitly.
- **Accepted:** you accepted my stated assumption ("for all other open
  questions, accept your stated assumptions").

| # | Topic | Decision | How |
|---|---|---|---|
| Q1 | Module default | A missing `enabledModules` key = **off**; new companies start with attendance/sites/tasks off. **Seed:** all three **on for ACME** (to test the features), **off for BETA** (to test `MODULE_DISABLED`). | Your answer |
| Q2 | Site visit starts the day | **Yes.** A site check-in starts the attendance day if there's no record for that work date. If the employee already checked in at the office, **only the visit is recorded**. A visit after the day was closed is also just recorded, doesn't reopen the day, and is **flagged `AFTER_HOURS`** so it shows in HR reports (your answer, 2026-11-06). On a day already marked `ABSENT`, the row is left alone and the visit is **flagged `ON_ABSENT_DAY`**, shown in the HR daily report so HR can correct it (your answer, 2026-11-06). Architecture §1.6. | Your answer |
| Q3 | Sessions per day | One check-in/out pair per work date. No lunch-break out/in. | Accepted |
| Q4 | Offline | **No offline check-in in Phase 2**, because the device clock can be manipulated. The app shows **"No internet connection, try again"**. Offline check-in is noted as a **possible future requirement** (architecture §1.5). | Your answer |
| Q5 | Site assignment | Any employee can pick any active external site. No per-employee assignments. | Accepted |
| Q6 | GPS at non-required sites | **No location collected** at sites that don't require GPS. The server also discards any location sent for them. | Your answer |
| Q7 | Managers and coordinates | Managers see within-radius / distance only. HR and Company Admin see exact positions (detail view). | Accepted |
| Q8 | Half-day leave | Skip lateness on half-day leave days; no check-in that day = `ON_LEAVE` (flag `HALF_DAY_LEAVE`). Morning/afternoon is not recorded (a possible future leave change). | Accepted |
| Q9 | Check-in on approved leave | Allowed, flagged `ON_APPROVED_LEAVE`; the leave isn't cancelled, and HR isn't notified (the flag shows in the daily report). | Accepted |
| Q10 | Early leave / overtime | Early leave is recorded in minutes, not as a status. No overtime in Phase 2. | Accepted |
| Q11 | Half-day end | `HALF` days end at `halfDayEndTime`, default 13:00. | Accepted |
| Q12 | Night shifts | Supported via per-employee overrides that cross midnight. No rotating rosters. | Accepted |
| Q13 | Prisma back-relations | **Approved.** Back-relation fields on `User` and `Company` are fine because they generate no SQL. The migration rule is in the schema doc, "Migrations: Prisma back-relations and the freeze". | Your answer |
| Q14 | iOS | Android only in Phase 2. | Accepted |
| Q15 | Employee correction requests | Not in Phase 2; HR corrects. | Accepted |
| Q16 | Privacy policy link | No company-specific link in Phase 2. An app-level URL is needed at Play Store publishing time. | Accepted |
| Q17 | GPS retention | 90 days by default, configurable 30–365. | Accepted |
| Q18 | Check-in reminder timing | At the scheduled start, plus `checkinReminderOffsetMinutes` (default 0). | Accepted |
| Q19 | Proof deadline after "info required" | The deadline stays the same; there's no fresh deadline. | Accepted |
| Q20 | Job runner | The in-house runner (`job_runs` claims + `SKIP LOCKED`), not pg-boss. | Accepted |
| Q21 | Push client | **The official `expo-server-sdk`**, not plain fetch. It's a new `apps/api` dependency in step 2.9b, wrapped in a `PushSender` interface so tests use a fake. | Your answer |
| Q22 | Task deletion | Hard delete, not audited. | Accepted |
| Q23 | New libraries | **Approved:** `expo-location` (2.4), `expo-dev-client` (2.9a), `expo-notifications` + `expo-device` (2.9b), each installed with `npx expo install`. Plus `expo-server-sdk` (Q21). EAS CLI runs through `npx` and isn't a dependency. | Your answer |
| Q24 | Web check-in | Mobile app only; no web check-in button. | Accepted |

**Future requirements noted (not in Phase 2):**
- offline check-in (Q4)
- multiple sessions per day (Q3)
- morning/afternoon half-day leave (Q8)
- per-employee site assignments (Q5)
- employee correction requests (Q15)
- rotating rosters (Q12)
- overtime (Q10)
- iOS push (Q14)
