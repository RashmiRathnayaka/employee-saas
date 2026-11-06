# Step 2.3 progress — Office attendance

Plan: `docs/phase2/plan.md` → 2.3. Report: `docs/reports/step-2.3.md`.

## Decisions from the developer (2026-11-06)
- [x] `ON_ABSENT_DAY` replaces `AFTER_HOURS` only on `ABSENT` days. `ON_LEAVE` and
      `HOLIDAY` days keep `AFTER_HOURS`. Already in the docs that way; confirmed.
- [x] "Paste lat, lng" added to the UX backlog.

## Bug fix before the step
- [x] Company profile colour: show the app's real default when none is stored
- [x] A stored colour no longer shows, or saves, as black either (the same cause)
- [x] Send `primaryColor` only if the user changed it
- [x] Tests, plus a check in real Chromium

## Docs (before code)
- [x] Architecture §1.3 and §1.5: check-out finds the current record (night-shift fix)
- [x] Architecture, schema, API: what ships now vs in 2.4/2.5/2.6
- [x] Plan: work carried to 2.4 and 2.7

## Shared (`packages/shared`)
- [x] Attendance enums, request, response and list schemas
- [x] `formatTime`, `formatDuration`
- [x] Tests

## Database
- [x] Dev row counts snapshotted before the migration
- [x] `schema.prisma`: `AttendanceRecord`, enums, back-relations
- [x] Migration from `prisma migrate diff`, plus hand-written indexes + CHECKs
- [x] Freeze check: no `ALTER TABLE` on companies / users / refresh_tokens
- [x] Applied to test DB
- [x] Applied to dev DB with `migrate deploy` (no reset, no reseed)
- [x] Indexes/constraints confirmed in the database
- [x] Dev row counts compared after the migration

## API
- [x] `AttendanceRecord` in `TENANT_MODELS`
- [x] Pure rules: effective schedule, status, lateness, worked minutes, close time
- [x] Router behind `requireModule("attendance")`
- [x] `/attendance/me/today`, check-in, check-out, `/attendance/me`, `/attendance/:id`
- [x] Edge-case 409s, `clientRequestId` retries, two simultaneous check-ins → one row
- [x] Night-shift check-out finds the open record
- [x] Tests: rules, roles, cross-tenant 404s, `MODULE_DISABLED`, SUPER_ADMIN

## Mobile
- [x] Attendance card on Home
- [x] Attendance tab with history (infinite list)
- [x] Both hidden when the module is off
- [x] Offline: "No internet connection, try again", nothing queued
- [x] Tests

## Close
- [x] Workspace typecheck (exit 0)
- [x] Workspace lint (exit 0)
- [x] Workspace test (exit 0, 902 tests)
- [x] Real-browser and real-server check against the test DB (not in the repo)
- [x] Dev DB row counts compared again after the test run (the migration row, the new
      empty table, and one `refresh_tokens` row from the developer's own browser)
- [x] `docs/reports/step-2.3.md`

## Still to do by the developer
- [ ] Stop `pnpm dev`, run `pnpm --filter @employee-saas/api db:generate`, restart.
      The dev API isn't listening on port 4000 at the moment (see `step-2.3.md`).
- [ ] Run the checklist in `step-2.3.md`, including on the phone
- [ ] Answer the two questions in `step-2.3.md`
