# Step 1.7 — progress checklist

Source prompt: `docs/prompts/step-1.7.md`. Tick items as they're done so an
interrupted session can pick up from here.

## 0. Architecture freeze
- [x] Rule added to CLAUDE.md "How to work" (#11): auth, tokens, users and
      companies are frozen; ask before changing them.
- [x] 1.7a needed no changes to auth, tokens, login, `users` or
      `companies`. `companies.timezone` is only **read** (new
      `apps/api/src/lib/companyTime.ts`).

## 1.7a — Timezone date bug check (web + API)
- [x] Searched apps/web, apps/api (src + prisma/seed.ts) and packages/shared
      for `toISOString().slice(0, 10)`, `new Date("YYYY-MM-DD")`,
      `getDate()`/`setDate()`, `getUTCFullYear()` / "current year", and
      "today" computations. Also checked apps/mobile, since its helpers move.
- [x] Classified every hit (table below)
- [x] Shared helpers: `packages/shared/src/dates.ts` (exported from the index)
- [x] API uses the company timezone for today and the current year
- [x] Web and mobile import the shared helpers; old copies deleted
      (`apps/web/src/lib/formatDate.ts`, `apps/mobile/src/lib/formatDate.ts`
      + its test, which moved into shared)
- [x] Tests under TZ=Asia/Colombo and TZ=UTC (shared, API unit, API integration)
- [x] Mutation check: put the old logic back for a moment. The new
      integration tests failed 4/8, then passed again after restoring the fix.
- [x] Workspace typecheck, lint and test run; `expo export --platform android` run, then dist/ deleted
- [x] docs/architecture.md §8 "Dates and timezones" added; CLAUDE.md commands updated
- [x] Stopped for developer review. 1.7a was committed and pushed by the developer.

### Findings

| # | Location | Pattern | Verdict |
|---|---|---|---|
| 1 | `api/.../leaveBalances/leaveBalances.service.ts` `currentYear()` | `new Date().getUTCFullYear()` | **Bug, fixed.** From 00:00 to 05:30 on 1 Jan in Colombo, the API still returned *last year's* balances. Now uses the company's timezone. |
| 2 | `api/.../employees/employees.service.ts` (create employee) | `getUTCFullYear()` for the seeded balance year | **Bug, fixed.** An employee created in that same window got last year's balance rows. |
| 3 | `api/.../leaveTypes/leaveTypes.service.ts` (create leave type) | same | **Bug, fixed.** Same issue for new leave types. |
| 4 | `api/prisma/seed.ts` | same | **Bug (dev-only), fixed.** Now uses Colombo's year. The seed was **not** re-run. |
| 5 | `api/.../leaveRequests.service.ts` past-date check | `getTodayInTimezone(company.timezone)` + ms arithmetic | **Safe** (already used the company's timezone). Moved onto shared `todayInTimezone` + `daysBetweenIsoDates`. |
| 6 | `api/.../leaveDecisions.service.ts` revoke "already started" check | same | **Safe.** Moved onto `companyTodayAsUtcDate`. |
| 7 | `api/.../dashboard.service.ts` "on leave today" | same | **Safe.** Moved onto `companyTodayAsUtcDate`. |
| 8 | `api/src/lib/leaveDays.ts` `toDateKey`, `getUTCDay`, `setUTCDate` | `toISOString().slice(0,10)` on UTC-midnight dates | **Safe.** The inputs *are* UTC midnight (Prisma `@db.Date`), so UTC fields are the calendar day. Now uses the shared `utcDateToIsoDate`. Proven under both TZs. |
| 9 | `api/.../leaveRequests.routes.ts`, `employees.routes.ts` DTOs | `toISOString().slice(0,10)` on `startDate`/`endDate`/`joiningDate` | **Safe.** `@db.Date` values (UTC midnight). |
| 10 | `api/.../company.service.ts` `createHoliday`, `employees.service.ts` `joiningDate` | `new Date("YYYY-MM-DD")` | **Safe.** ECMAScript parses a date-only string as UTC midnight, which is exactly what Prisma wants for `@db.Date`. The input is regex-validated `YYYY-MM-DD` by the shared Zod schema. |
| 11 | `api/.../leaveRequests.service.ts` `proofDueAt` | `startDate + N × 86 400 000 ms` | **Safe** (UTC-midnight arithmetic, no DST in UTC). Rewritten as `addDaysToIsoDate` for clarity; the stored value is identical. |
| 12 | `startDate.getUTCFullYear()` (balance year in decisions/cancel/deactivate) | — | **Safe.** UTC fields of a `@db.Date`. |
| 13 | `createdAt`/`decidedAt`/`uploadedAt`/`revokedAt` `.toISOString()`, `auth.service` expiry, `fileToken`, health timestamp | — | **Safe.** Real instants, meant to be UTC. |
| 14 | `web/src/lib/formatDate.ts` | `new Date("YYYY-MM-DD")` then formatted in the company timezone | **Latent bug, fixed.** Correct for Colombo (UTC midnight is 05:30 the same day) but one day early for any company west of UTC (e.g. `America/New_York` would show a 15 Mar leave as 14 Mar). The shared `formatDate` shows a date-only value as exactly that day. |
| 15 | `web` `<input type="date">` (MyLeave, CreateEmployee, Holidays) | — | **Safe.** The browser gives a `YYYY-MM-DD` string directly; no `Date` is involved. |
| 16 | `web/src/lib/useLeaveRequestsList.ts` sort by `createdAt` | `getTime()` | **Safe.** Timestamp comparison. |
| 17 | `mobile/src/app/(tabs)/index.tsx` `todayIso()` | `new Date().toISOString().slice(0,10)` | **Bug, fixed.** The same mobile bug was left in Home's "next upcoming leave". From 00:00 to 05:30 Colombo, a leave that started yesterday still showed as upcoming. Now uses the company's today. |
| 18 | `mobile/.../leave/apply.tsx` picker `minimumDate` | device-local today | **Bug, fixed.** It now uses the company's today, the same day the API validates against. Before, a phone set to another timezone could allow or forbid a different day than the API. |
| 19 | `mobile/.../leave/[id].tsx` `proofDueAt` | timestamp formatted in a timezone | **Latent bug, fixed.** `proofDueAt` is UTC midnight of the due day, so it would show a day early west of UTC. It is now shown as its calendar date. |
| 20 | mobile `decidedAt` / `uploadedAt` | `formatDate` without a timezone (always Colombo) | **Inconsistency, fixed.** Now uses the company's timezone, like the web. |
| 21 | API test files (`employees.test.ts` +10 days, `leaveRequests.test.ts` past-dates) | `toISOString().slice(0,10)` on "now ± N days" | **Safe in practice** (a margin of days, or fake time at 05:30 Colombo). The leaveRequests one now uses the shared helpers anyway. |
| 22 | `packages/shared` schemas | regex `YYYY-MM-DD` only | **Safe.** No `Date` parsing. |

### Known flake (not caused by this step, as far as I can tell)
`leaveDecisions.test.ts > approval history ...` failed once in the first of
three full workspace `pnpm test` runs, then passed in every later run (alone
3×, full API suite, full workspace). That run's error message wasn't saved.
The test doesn't use the date code changed here (fixed March dates, approve
path only). My best guess is a timeout from parallel load across the
workspace, but that's unconfirmed. If it happens again, capture the output.

## 1.7b — Notifications API
- [x] Shared contract: `packages/shared/src/notifications.ts`, with
      `NOTIFICATION_TYPES`, `NotificationSchema`, `NotificationListQuerySchema`
      (`unreadOnly` takes the literal "true"/"false"), and the unread-count
      and read-all response schemas
- [x] `apps/api/src/modules/notifications/` routes + service + test, registered in `app.ts`
  - `GET /notifications`: own only, newest first (ties broken by `id`), paginated, `unreadOnly`
  - `GET /notifications/unread-count`
  - `PATCH /notifications/read-all`, registered before `/:id/read`
  - `PATCH /notifications/:id/read`: idempotent (`updateMany ... readAt: null`, so the first `readAt` is kept)
  - Another user's or another company's row → 404
- [x] Event audit. Gaps found and fixed:
  1. **Cancel wrote no notification.** It now writes `LEAVE_REQUEST_CANCELLED` to the employee.
  2. **Document review didn't include the HR note**, and linked to
     `LeaveRequestDocument` + document id. No app screen opens a document on
     its own, so it now links to `LeaveRequest` + the request id. The title
     differs per status.
  3. **The MANAGER → HR hand-off reused the type `LEAVE_REQUEST_SUBMITTED`**
     with a generic body. It now has its own type,
     `LEAVE_REQUEST_PENDING_HR`, and the body names the employee and dates.
  4. **A manager with no login, or a deactivated one, meant nobody was notified.**
     The request now goes to HR instead.
  5. **An HR user with no manager was notified to approve their own request**,
     which they can't do. The requester is now always excluded.
  6. Approve/reject/revoke bodies now include the dates and the decision note.
- [x] `lib/notifications.ts`: typed `type` / `relatedEntityType`, plus helpers
      `findActiveHrUserIds`, `notifyUsers`, `leaveRangeText`, `withNote`
- [x] Tests: 18 in `notifications.test.ts`. Each event test checks the
      complete set of rows created: the expected user(s) and nobody else.
- [x] Mutation check: without the `userId` filter, 3 own-only tests fail. Restored afterwards.
- [x] Docs: api-phase1.md Notifications (rules + event/recipient table), architecture.md §7
- [x] Workspace typecheck/lint clean; `pnpm test` run twice in full, all green
      (shared 26, web 18, mobile 21, api 177). The leaveDecisions flake did not reappear.
- [x] Stopped for developer review. 1.7b was committed and pushed by the developer.

### 1.7b follow-up (developer request, before 1.7c)
- [x] **Cancel recipients changed.**
  - Employee cancels → whoever's queue it was in: the manager
    (`PENDING_MANAGER`, or HR if the manager has no active login) or active
    HR (`PENDING_HR`). The requester is never included.
  - System cancel (employee deactivation cascade in `employees.service.ts`)
    → the employee, one notification per request, saying why.
  - Submit and cancel now share `findCurrentApproverUserIds()`
    (`leaveRequests.service.ts`), so both always reach the same people.
  - Tests: the old "cancelled → employee" test is replaced by 4: manager
    queue, HR queue after the manager step, HR requester, deactivation
    cascade with 2 pending requests.
- [x] **Index `notifications(companyId, userId, createdAt)`**, migration
      `20261103120000_notifications_user_created_at_index`.
  - Generated with `prisma migrate diff` between the old and new
    schema.prisma, **not** `prisma migrate dev`. Earlier migrations contain
    hand-written SQL that isn't in the Prisma schema
    (`departments_companyId_lower_name_key` etc., and CHECK constraints), so
    a DB-vs-schema diff could have tried to drop it. The schema-vs-schema
    diff was exactly one `CREATE INDEX`.
  - Applied with `prisma migrate deploy`, which only runs pending migrations
    and never resets, to dev (`employee_saas`) and test
    (`employee_saas_test`). Checked in `pg_indexes` on both: the new index
    exists and `departments_companyId_lower_name_key` is still there.
- [x] Docs: api-phase1.md cancel rows, database-schema.md index note

### Test-writing note
The first version of the event tests failed with 401s. This was the
**login rate limit** (10 per company code per 15 min), not a bug in the
API: `createEmployeeWithLogin` uses 2 logins, and the setup made 11 in
total. Users that only receive notifications are now created with
`createTestUser` and never log in.

## 1.7c — Notifications UI (web + mobile)
- [x] Shared: `formatUnreadBadge`, `getNotificationLeaveRequestId` (+ tests)
- [x] Web:
  - top-bar bell with badge and dropdown (latest 5), "Mark all as read", "View all"
  - `/notifications` page with All / Unread tabs and paging
  - click → mark read → `/leave-requests/:id`
  - count refreshes on focus and every 60s
  - no bell for SUPER_ADMIN
- [x] Mobile:
  - Home header bell with badge
  - root-stack `notifications` screen: pull-to-refresh, scroll to load more, mark all
  - tap → mark read → `/leave/<id>`; Leave stack's `initialRouteName` keeps Back working
  - count refreshes on app foreground (`useAppStateFocus`) and on Home focus
- [x] Strings in `strings.ts`; loading, empty and error states; times via shared `formatDateTime` (company timezone)
- [x] Tests: web +8, mobile +8
- [x] Mobile Jest exit fix: `jest.setup.ts` gives the shared client a test-only infinite gcTime and clears it after each test. A single file went from 4m40s to about 7s.
- [x] Typed routes regenerated with a short `expo start` (CI mode), then stopped
- [x] Workspace typecheck, lint and test (3 full runs, explained in step-1.7.md); `expo export --platform android` run, then `dist/` deleted

## Finish
- [x] docs/reports/step-1.7.md with the real-device checklist
- [x] CLAUDE.md status: "implemented, awaiting device check". Mark Phase 1 complete only after the developer confirms.
- [x] Real-device test passed (developer, 2026-11-03). Step 1.7 and Phase 1 complete.
