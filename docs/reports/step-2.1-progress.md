# Step 2.1 progress — Foundations

Plan: `docs/phase2/plan.md` → 2.1. Report: `docs/reports/step-2.1.md`.

## Decisions from the developer (2026-11-06)
- [x] A site check-in after the day is closed records the visit, doesn't
      reopen the day, and is flagged `AFTER_HOURS` so HR reports show it.
      Docs updated. (The code itself comes in step 2.5.)
- [x] **The dev DB is not reseeded.** It holds real-device test data. ACME's
      modules get switched on by the developer from the new settings page.

## Docs
- [x] `AFTER_HOURS`: architecture §1.6 + §6, schema, API, plan (Q2, step 2.5)
- [x] Seed rule, `enabledModules` merge rule, redaction paths, DST rules

## Shared (`packages/shared`)
- [x] `isModuleEnabled()` + module keys
- [x] `company_settings` request/response schemas
- [x] `zonedDateTimeToUtc`
- [x] `getWorkDate`
- [x] `haversineMeters`
- [x] `getNotificationTarget` (replaces `getNotificationLeaveRequestId`)
- [x] Tests under Asia/Colombo, UTC and a DST zone

## Database
- [x] `schema.prisma`: 11 `company_settings` columns, `notifications.dedupeKey`
- [x] Migration from `prisma migrate diff`, hand-written CHECKs + partial index
- [x] Freeze check: no `ALTER TABLE` on companies / users / refresh_tokens
- [x] Applied to test DB
- [x] Applied to dev DB with `migrate deploy` (no reset, no reseed)
- [x] Indexes/constraints confirmed in the database

## API
- [x] `requireModule()` middleware, 403 `MODULE_DISABLED`, 30 s cache
- [x] `PATCH /company/settings`: new fields, audit before/after, cache refresh
- [x] Pino redaction for location fields
- [x] Tests: module gate, settings, cross-tenant, dedupe index, redaction

## Seed
- [x] ACME modules on, BETA off, on first creation only
- [x] Verified against the **test** DB only

## Web and mobile
- [x] Settings page: module switches, working hours, grace, auto-checkout,
      reminders, GPS accuracy/retention
- [x] `getNotificationTarget` in web and mobile, with no behaviour change
- [x] Web tests

## Close
- [x] Workspace typecheck (exit 0)
- [x] Workspace lint (exit 0)
- [x] Workspace test (exit 0, 501 tests)
- [x] Dev DB row counts unchanged
- [x] `docs/reports/step-2.1.md`

## Still to do by the developer
- [ ] Run the checklist in `step-2.1.md` on web and phone (not done yet)
- [ ] Answer the two questions in `step-2.1.md`
