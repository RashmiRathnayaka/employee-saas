# Step 2.2 progress — Sites

Plan: `docs/phase2/plan.md` → 2.2. Report: `docs/reports/step-2.2.md`.

## Decisions from the developer (2026-11-06)
- [x] A site check-in on a day already marked `ABSENT` leaves the row alone and
      flags the visit `ON_ABSENT_DAY`, shown in the HR daily report. Docs only
      now; the code comes in 2.5, 2.6 and 2.11.
- [x] The 1–16 hour shift rule also applies to the company default hours.

## Docs (before code)
- [x] `ON_ABSENT_DAY`: architecture §1.6 + §6, schema, API, plan
- [x] Shift-length rule and GPS radius range: schema, API
- [x] Sites design details: architecture §2, schema, API
- [x] "UX improvements backlog" section in the plan

## Shared (`packages/shared`)
- [x] `gpsRadiusMeters` range 25–5000
- [x] Shift-length helper + schema rule
- [x] Site request/response/list schemas + location rule helper
- [x] Tests

## Database
- [x] Dev row counts snapshotted before the migration
- [x] `schema.prisma`: `Site`, `SiteType`, back-relations on `Company`/`User`
- [x] Migration from `prisma migrate diff`, plus hand-written index + CHECKs
- [x] Freeze check: no `ALTER TABLE` on companies / users / refresh_tokens
- [x] Applied to test DB
- [x] Applied to dev DB with `migrate deploy` (no reset, no reseed)
- [x] Indexes/constraints confirmed in the database
- [x] Dev row counts compared after the migration

## API
- [x] `Site` in `TENANT_MODELS`
- [x] Sites router behind `requireModule("sites")`
- [x] List, get, create, edit, status, delete-if-unused, with audit entries
- [x] Employees and managers never get coordinates or inactive sites
- [x] Settings: shift-length rule checked against stored values on a partial PATCH
- [x] Tests: CRUD, roles, cross-tenant 404s, `MODULE_DISABLED`, SUPER_ADMIN

## Web
- [x] Sites page: list, filters, create/edit form, map link, settings defaults
- [x] Nav item hidden when the module is off
- [x] Settings page: default GPS radius and "GPS required" fields
- [x] Tests

## Close
- [x] Workspace typecheck (exit 0)
- [x] Workspace lint (exit 0)
- [x] Workspace test (exit 0, 652 tests)
- [x] Dev DB row counts compared again after the test run (only the migration row
      and one `refresh_tokens` row from the developer's own browser session)
- [x] Real-browser check against the test DB (28 checks, not in the repo)
- [x] `docs/reports/step-2.2.md`

## Still to do by the developer
- [ ] Stop `pnpm dev`, run `pnpm --filter @employee-saas/api db:generate`, restart
      (`prisma generate` couldn't finish while the API held the engine file open)
- [ ] Run the checklist in `step-2.2.md`
- [ ] Confirm how `ON_ABSENT_DAY` was read (see `step-2.2.md`)
