# Phase 2 plan — Attendance & Site Management

**Status: proposal, awaiting approval (step 2.0).** No code before you
approve it.

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

**Try it:**
- Web as Company Admin: toggle modules and change working hours, save,
  reload, and the values persist.
- Audit log shows `COMPANY_SETTINGS_UPDATED`.
- Existing leave notifications still open the right screen on web and
  phone.

**Risks:**
- Getting the timezone/DST helper right without a library. It's mitigated
  by table-driven tests, including a night shift and the London DST change.
- The existing seed/dev companies have `enabledModules: {}`, so all Phase 2
  modules start **off** until you switch them on (Q1).

## 2.2 Sites (API + web)
**Scope**
- `sites` table.
- CRUD, deactivate and delete-if-unused endpoints.
- Audit entries.
- Web **Sites** page (HR / Company Admin): list with filters, create/edit
  form with lat/lng inputs, an "Open in Google Maps" check link, and
  defaults from settings.
- Cross-tenant and module tests.

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
  - Online-only error messages.

**Try it:**
- Phone (Alex): check in. The card shows the time and PRESENT or LATE,
  depending on the time vs 09:00 + 10 min.
- Tap again: the button now says Check out.
- Check out: worked hours appear.
- Airplane mode + tap: a clear "not recorded" message.
- Web as HR: nothing yet (the HR views come in 2.6). The API log shows the
  rows.

**Developer side task:** create the Expo account and Firebase project now
(architecture §4.7, steps 1–4). It takes calendar time, not code time.

**Risks:**
- The night-shift work-date logic. It's covered by unit tests here, and
  you can try it on the phone in 2.6, once schedule overrides exist.

## 2.4 GPS verification + privacy disclosure
**Scope**
- `expo-location` (needs your approval). Foreground permission only, and
  the plugin config removes the background permission.
- Disclosure screen before the first permission prompt.
- **Profile → Location & privacy** screen.
- Server GPS rules (architecture §3.2): reject vs flag, and the audit row on
  a mock rejection.
- Nearest-office selection.
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
- Try a second check-in while one is open → "Check out of X first".

**Risks:**
- The UX of "day check-in" vs "site check-in" on one Home screen. We'll do
  a quick design pass on the phone before polishing it.

## 2.6 HR attendance views, corrections, schedule overrides
**Scope**
- Web **Attendance** page:
  - HR: daily view with status chips and flags;
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

## 2.7 Job runner + day close (auto-close + absent marking)
**Scope**
- `job_runs`.
- `apps/api/src/worker.ts` with the tick loop, the claim logic and stuck-run
  recovery. `pnpm dev` starts it.
- `attendance.dayClose`: auto-close → INCOMPLETE + notify; absent /
  on-leave / holiday rows.
- Cross-module hooks: leave approve/revoke/cancel and holiday add/delete
  flip past rows.
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
  - add `expo-dev-client` + `eas.json`;
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
- API tests mock Expo's HTTP endpoints. There are no real network calls in
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
  formula-injection guard, no coordinates, audited).
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

## Open questions for you
I made an assumption for each one so the design is complete. Tell me where
I'm wrong.

1. **Q1 Module default.** A missing `enabledModules` key = **off**, so
   existing companies (ACME, BETA) start with attendance/sites/tasks off
   until a Company Admin switches them on. The alternative is on by default.
2. **Q2 Site visit starts the day.** I assumed the first site check-in also
   starts the attendance day, for field workers who never visit the office.
   Is that right, or must they always do an office/day check-in first?
3. **Q3 One check-in/out pair per day.** No lunch-break out/in. Is that
   enough for your target companies?
4. **Q4 Offline.** Online-only in Phase 2 (server time is the truth). Do
   your target customers have sites with no signal (construction, rural)?
   If so, offline check-in needs its own step.
5. **Q5 Site assignment.** Any employee can pick any active site; there are
   no per-employee assignments. Is that OK, or should HR assign sites to
   people?
6. **Q6 GPS when not required.** I collect **no** location at sites where
   GPS isn't required (data minimisation). The alternative is to always
   collect it and only flag problems. That's more data for HR, but more
   privacy risk.
7. **Q7 Managers and coordinates.** Managers see "within radius / distance",
   not the exact position. HR and Company Admin see the exact position.
8. **Q8 Half-day leave.** Phase 1 doesn't record *which* half was taken. On
   half-day leave days I skip lateness, and a day with no check-in counts
   as ON_LEAVE. Should we add morning/afternoon to leave requests (a leave
   module change)?
9. **Q9 Check-in on an approved leave day.** It's allowed and flagged for
   HR, but the leave isn't cancelled. Should HR also get a notification?
10. **Q10 Early leave and overtime.** Early leave is recorded in minutes but
    isn't a status. Overtime isn't calculated in Phase 2. OK?
11. **Q11 Saturday half-day.** `HALF` days end at `halfDayEndTime` (default
    13:00). Is that right for your companies?
12. **Q12 Night shifts.** Supported through per-employee schedule overrides
    that cross midnight. Rotating rosters (different shifts per week) are
    **not** in Phase 2. OK?
13. **Q13 Prisma back-relations under the freeze.** New tables need
    back-relation lines inside the `Company` and `User` model blocks of
    `schema.prisma`. They generate no SQL on `companies`/`users`, and I'll
    show the `migrate diff` to prove it. Is that acceptable?
14. **Q14 iOS.** Push and testing are Android-only for now (iOS needs an
    Apple Developer account, $99/yr). Confirm?
15. **Q15 Employee correction requests.** Employees can't request a
    correction in the app ("I forgot to check out"); they tell HR, and HR
    corrects it. Should a "request correction" button be in Phase 2?
16. **Q16 Privacy policy.** Should the location disclosure link to a
    company-specific privacy policy URL (a new company setting)? Google
    Play will want an app-level privacy policy URL at publishing time
    anyway.
17. **Q17 GPS retention.** Raw coordinates are deleted after 90 days by
    default (configurable 30–365). Is that a good default?
18. **Q18 Check-in reminder timing.** It's sent at the scheduled start (as
    the brief says), offset configurable. Would start + grace (e.g. 09:10)
    be less annoying?
19. **Q19 Proof deadline after "info required".** The Phase 1 deadline
    stays the same after HR asks for more info, so the reminder can fire
    straight away. Should "info required" give the employee a fresh
    deadline?
20. **Q20 Job runner.** I recommend the in-house runner (claim table + SKIP
    LOCKED) over pg-boss (architecture §5.1). OK?
21. **Q21 Expo push client.** Plain `fetch` (no new library) vs Expo's
    `expo-server-sdk`. I'd go with plain fetch.
22. **Q22 Task deletion.** Hard delete, not audited. OK, or should tasks be
    soft-deleted?
23. **Q23 New libraries.** This phase needs `expo-location` (2.4) and
    `expo-notifications`, `expo-device`, `expo-dev-client` (2.9), all
    installed via `npx expo install`. EAS CLI is used through `npx`. There
    are no new API or web libraries. Do you approve them, each at its step?
24. **Q24 Web check-in.** HR and managers check in from the mobile app only.
    There's no web check-in button. OK?
