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
- [ ] **Stopped here for developer review before 1.7b**

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
- [ ] not started

## 1.7c — Notifications UI (web + mobile)
- [ ] not started

## Finish
- [ ] docs/reports/step-1.7.md with the real-device checklist
- [ ] CLAUDE.md status (Phase 1 complete after the device test is confirmed)
