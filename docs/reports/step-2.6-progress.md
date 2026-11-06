# Step 2.6 progress

Plan: `docs/phase2/plan.md` → 2.6. Report: `docs/reports/step-2.6.md`.

## Setup
- [x] Dev row counts snapshot, before any migration

## Asked for before 2.6
- [x] Mobile: "Check in at <site>?" confirmation, with a test
- [x] Web: visit detail for HR and Company Admin (coordinates, accuracy, Google Maps), never for managers, with tests for both roles
- [x] Plan backlog: "Web portal scrolls sideways at phone width (app shell sidebar)"
- [x] Keep `AFTER_HOURS` visits past the close time unlinked with no row (no code change, recorded in the docs)

## Shared
- [x] Correction, create-record, attendance list and site visit correction schemas
- [x] Schedule schemas (override, effective schedule, next 14 days)
- [x] `ATTENDANCE_CORRECTED` notification type

## API
- [x] `employee_schedules` and `attendance_corrections` tables, hand-written CHECKs
- [x] Freeze check on the generated SQL
- [x] Migration applied to test and dev, dev row counts compared
- [x] Per-employee override in the effective schedule, including night shifts and half days
- [x] `/schedule/me`, `GET/PUT/DELETE /employees/:id/schedule`, audited
- [x] `GET /attendance`, `GET /attendance/team`, with names and `ON_ABSENT_DAY`
- [x] `PATCH /attendance/:id/correct`, `POST /attendance`, reason required, self-correction blocked
- [x] `PATCH /site-visits/:id/correct`
- [x] Correction history on `GET /attendance/:id` and `GET /site-visits/:id`
- [x] `ATTENDANCE_CORRECTED` in the same transaction
- [x] Cross-tenant and `MODULE_DISABLED` tests

## Mobile
- [x] My schedule (next 14 days) on the Attendance tab
- [x] A correction notification opens the Attendance tab

## Web
- [x] Attendance page: HR daily view, manager team view, status chips and flags
- [x] Record detail with visits and correction history, positions for HR and Company Admin only
- [x] Correct-record and create-missing-record dialogs
- [x] Site visit correction
- [x] Schedule section on the employee page
- [x] Company-time inputs, tested with the browser in another timezone

## Real servers
- [x] Temporary API on 4001 and Vite on 5199, test database, stopped afterwards

## Finish
- [x] Docs updated
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`
- [x] Dev row counts compared at the end
- [x] `docs/reports/step-2.6.md` and the commit list
