# STEP 2.0 — Phase 2 design (Attendance & Site Management)

Read CLAUDE.md, docs/proposal.md (sections 2, 3, 5, 8), docs/architecture.md, docs/database-schema.md, docs/permissions.md, docs/api-phase1.md and docs/reports/step-1.7.md first.

This step is DESIGN ONLY. Do not write application code or migrations. Never commit or push.

## Rules that still apply
- **Architecture freeze:** do not change authentication, tokens, login endpoints, the `users` table or the `companies` table. New tables may reference `users.id` and `companies.id`, but must not change those tables. A central identity service will replace HR login later (see docs/architecture/platform.md if it exists).
- New Phase 2 data links to `employees.id` wherever it is about a person's work (attendance, visits, tasks). Use `users.id` only where it is truly about a login (e.g. push device tokens), so the later migration to central accounts stays simple.
- Every new company-owned table has `companyId`, goes through `getTenantPrisma`, and gets cross-tenant 404 tests.
- All dates and times follow docs/architecture.md section 8: calendar dates as `YYYY-MM-DD` in the company timezone, timestamps in UTC, shared helpers from packages/shared.
- Respect `company_settings.enabledModules`. When a module (`attendance`, `sites`, `tasks`) is off, its endpoints return 403 MODULE_DISABLED and the apps hide it.

## Prerequisite fix (do this first; it is a small code change and is allowed)
Root `pnpm test` runs all workspaces in parallel, and API tests sometimes time out under that load (seen twice in step 1.7).
- Make the root test script run workspaces one at a time (e.g. `pnpm -r --workspace-concurrency=1 test`), or another fix you can justify.
- Run the full suite 3 times to show it is stable.
- Record the change in CLAUDE.md "Commands".

## Scope of Phase 2 (from docs/proposal.md)

**1. Office attendance**
- check-in / check-out from the mobile app
- working hours per company with a late-arrival grace period
- worked minutes
- statuses: PRESENT, LATE, ON_LEAVE, HOLIDAY, ABSENT, INCOMPLETE (no check-out)
- HR corrections with a required reason (audited)
- a missed check-out is closed automatically at end of day as INCOMPLETE

**2. Work sites and site visits**
- HR / Company Admin manage sites:
  - name, address, latitude/longitude, radius in metres, GPS required yes/no, active
  - a site can be the company OFFICE
- employees select a site, check in and check out; the duration is calculated
- managers get a notification when a team member checks in at a site
- GPS: foreground only, captured only at check-in and check-out. The server calculates the distance (haversine) and stores lat, lng, accuracy, distance and withinRadius.
- Design how to handle:
  - poor accuracy
  - being outside the radius when GPS is required
  - mock locations (expo-location reports a mocked location on Android)

  Propose whether each case is rejected or allowed but flagged for HR, and why.

**3. Work schedules and tasks (keep it simple)**
- a company default schedule (start time, end time, working days already in company_settings)
- optional per-employee schedule override
- tasks: title, description, assignee, optional site, due date, status TODO / IN_PROGRESS / DONE, created by; managers assign to their team, employees update their own tasks' status

**4. Push notifications**
- Send the existing in-app notifications to the phone as well.
- Design:
  - a device token table
  - sending through the Expo push service
  - handling receipts
  - removing invalid tokens
  - per-user opt-out
- Note: on Android, push notifications need an Expo development build (EAS), not Expo Go, and FCM credentials. Describe exactly what the developer must set up (accounts, credentials, build commands) and how they will test it on their phone.

**5. Reminders and scheduled jobs**
Jobs:
- sick-leave proof due tomorrow → employee
- proof overdue → HR
- check-in reminder at schedule start if not checked in → employee
- end-of-day auto close of missing check-outs
- daily absent marking for working days with no attendance and no approved leave

Propose a job runner that needs no new infrastructure (e.g. a Postgres-backed queue such as pg-boss, or a jobs table with advisory locks). Requirements:
- jobs run in the company's timezone
- jobs are idempotent
- jobs are safe if two API instances run at the same time

**6. Attendance and site reports**
- daily attendance for a date
- monthly summary per employee (days present / late / absent / on leave, total hours)
- site visit history
- CSV export (Excel / PDF come in Phase 3)
- managers see their team only

## What to produce (docs only)
1. `docs/phase2/database-schema-phase2.md`: new tables with fields, constraints, indexes, a Mermaid ER diagram of the new tables and how they connect to existing ones, and any `company_settings` additions (allowed: company_settings is not frozen).
2. `docs/phase2/api-phase2.md`: endpoint list (method, path, role, purpose), in the same style as docs/api-phase1.md.
3. `docs/phase2/permissions-phase2.md`: role × action matrix for the new actions (employee own, manager own team, HR / Company Admin all, Super Admin none).
4. `docs/phase2/architecture-phase2.md`:
   - attendance rules and edge cases: night shifts crossing midnight, check-in on a holiday or approved leave day, double check-in, check-out without check-in, phone offline
   - GPS and privacy, including what employees are told and data retention
   - push notification design
   - the job runner
   - how all of this stays compatible with the future central identity migration
5. `docs/phase2/plan.md`:
   - Phase 2 broken into steps (2.1, 2.2, ...), each small enough to build, test on a real device and commit in one or two sessions
   - for each step: scope, what the developer can try on the phone or web at the end, and risks
6. A short list of **open questions for me**: anything in the proposal that is unclear or where you made an assumption.

When done, give me a short summary and WAIT for my approval before any code (except the prerequisite test fix). Save the summary to docs/reports/step-2.0.md.
