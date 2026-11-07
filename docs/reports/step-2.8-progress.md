# Step 2.8 progress: Reminders and housekeeping jobs

Plan: `docs/phase2/plan.md` → 2.8. Design: `architecture-phase2.md` §3.5, §5.4.

## Before 2.8
- [x] UX backlog: "My visits: explain an auto-closed visit" added to `plan.md`
- [x] Dev row counts snapshot (no migration was needed: every column this step uses exists since 2.1)

## Part A: runner (platform-wide jobs, daily times)
- [x] `Job.runsWhileSuspended` (for the GPS purge)
- [x] Platform-wide jobs (`PlatformJob`, `companyId` NULL claim)
- [x] `getDueDailyKeys` pure helper + tests
- [x] Notification types `CHECKIN_REMINDER`, `LEAVE_PROOF_DUE_SOON` (the API doc's name), `LEAVE_PROOF_OVERDUE`, and `createNotificationsOnce`
- [x] Runner tests

## Part B: proof reminders
- [x] `leave.proofDueTomorrow` and `leave.proofOverdue`
- [x] Tests (switch, time, timezone, catch-up, statuses, once only, HR minus requester, two workers, cross-tenant, suspended)

## Part C: check-in reminder
- [x] `attendance.checkinReminder`
- [x] Mobile tap opens Attendance
- [x] Tests (time window, offset, skips, night shift, after midnight, switch, module, two workers, cross-tenant)

## Part D: GPS purge + housekeeping
- [x] `gps.purge`: clears coordinates only, never deletes rows; runs for suspended companies
- [x] `housekeeping`: `job_runs` older than 30 days, never the heartbeat
- [x] Tests

## Part E: wire up + check
- [x] Registered in `jobs.ts` last, so the dev worker under `tsx watch` never ran half-done code
- [x] Docs: architecture §5.4, api doc, schema doc, README, CLAUDE.md
- [x] Real worker run on the test DB (`scripts/browser-checks/reminders.mjs`): 15 of 15
- [x] Full workspace check: typecheck 0, lint 0, 1835 tests pass
- [x] Dev row counts compared: only `job_runs` 3 → 6 (the dev worker's own claims)
- [x] `docs/reports/step-2.8.md`
- [x] Each suggested commit replayed on a clean copy: all typecheck
