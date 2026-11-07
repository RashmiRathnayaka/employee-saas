# Step 2.7 progress checklist

Plan: `docs/phase2/plan.md` → 2.7.

## Before 2.7
- [x] Web and mobile test configs: `maxWorkers: 4` (`testTimeout` not needed)
- [x] `scripts/browser-check.mjs` + smoke check, tried for real

## Runner
- [x] Dev row counts snapshot before the migration
- [x] `job_runs` table + `attendanceEnabledAt` column, migration, no frozen tables changed
- [x] Applied to test, then dev. Counts compared
- [x] Claim, retry, stuck-run recovery, tick loop, heartbeat
- [x] `/health` worker status
- [x] Runner tests, with a fake clock

## Day close
- [x] Auto-close: `INCOMPLETE` + `AUTO_CLOSED` + notification, once
- [x] Auto-close finds a check-in with no schedule (check-in + 16 h)
- [x] A linked open visit closes with its record, an unrelated one doesn't
- [x] Open visits' own rule (check-in + 16 h), under the `sites` module
- [x] Absent marking through `resolveEffectiveSchedule`, per employee
- [x] `ON_LEAVE` (full and half day) / `HOLIDAY` / `ABSENT` / weekly off writes nothing
- [x] Unlinked visits get linked, `AFTER_HOURS` → `ON_ABSENT_DAY`
- [x] Not before joining date, not inactive, not before the module was on
- [x] `apps/api/src/worker.ts`, `pnpm dev` starts it, `JOBS_ENABLED=false`
- [x] Fake-clock tests: Colombo, night shift, override half day
- [x] Two workers test
- [x] Module and cross-tenant tests

## Hooks
- [x] Leave approved flips past `ABSENT` → `ON_LEAVE`
- [x] Leave revoked / cancelled flips back
- [x] Holiday added / deleted flips
- [x] Deactivating an employee closes their open work
- [x] Attendance switched on: `attendanceEnabledAt` stamped

## Finish
- [x] Docs updated
- [x] Real worker + real browser against the test DB
- [x] Each suggested commit typechecks alone
- [x] Full workspace typecheck, lint, test
- [x] Dev counts compared at the end
- [x] `docs/reports/step-2.7.md`
