# Step 1.4 Report — Leave module + sick leave documents

## What was done

**Three small fixes carried over from earlier steps:**
- Added `POST /users/:id/reset-password` (COMPANY_ADMIN any target; HR any
  target except COMPANY_ADMIN) — generates a new temporary password, sets
  `mustChangePassword`, revokes all the user's refresh tokens, and returns
  the password once in the response body.
- Turned on Prisma's `omit` API globally so `passwordHash` is excluded from
  every `User` query result by default (`new PrismaClient({ omit: { user:
  { passwordHash: true } } })`), instead of relying on every call site to
  remember to `select` it out. Required adding `previewFeatures =
  ["omitApi"]` to the `generator client` block since it isn't GA in the
  installed Prisma version (5.22). The three auth call sites that
  genuinely need the hash (login, change-password, password verification)
  override it explicitly with `omit: { passwordHash: false }`.
- Added DB `CHECK ("usedDays" >= 0)` and `CHECK ("pendingDays" >= 0)`
  constraints on `leave_balances` as a last line of defense behind the
  application-level balance math.

**Storage architecture replaced:** dropped the planned MinIO container
(2024 licensing change made it impractical for a disposable dev/CI
environment) in favor of a `StorageService` interface with two drivers:
`local` (writes to disk, serves downloads through the API itself via an
HMAC-signed short-lived token) and `s3` (any S3-compatible bucket,
presigned URLs). Selected per environment via `STORAGE_DRIVER`. No extra
container needed for local dev.

**Full leave module**, built module-by-module:
- **Leave types** — CRUD, company-scoped, carries `allowPastDates` (used
  by sick leave to permit backdated requests).
- **Leave balances** — per employee/leave-type/year, `GET /leave-balances/me`,
  `GET /employees/:id/leave-balances`, manual adjustment endpoint
  (audit-logged).
- **Leave requests** — submit, list (own / team / company-wide), get one,
  cancel. Day calculation respects `company_settings.workingDays`
  (FULL/HALF/OFF per weekday) and company holidays, and halves the
  start/end day if its half-day flag is set; a result of 0 days is
  rejected. Submission validates the date range stays in one calendar
  year, doesn't overlap an existing pending/approved request, and rejects
  past dates unless the leave type allows them.
- **Leave decisions** — approve/reject (idempotent, self-approval
  blocked), revoke (COMPANY_ADMIN/HR only, already-approved future leave
  only). Approval routing follows the company's `MANAGER_ONLY` /
  `MANAGER_THEN_HR` setting; no manager on file skips straight to HR; HR
  can always step in at the manager step as a fallback and that decision
  is final.
- **Sick leave documents** — multipart upload (max 5 MB, jpg/png/pdf),
  content type checked both by what the client declares and by sniffing
  the actual bytes (`file-type` package), so a renamed `.exe` is rejected
  either way. HR review sets `ACCEPTED`/`REJECTED`/`INFO_REQUIRED` and
  updates the parent request's `proofStatus`. Managers can never view or
  download a document, even their own direct report's.
- **Employee deactivation cascade** — deactivating an employee now also
  auto-cancels their still-pending leave requests and releases the
  reserved `pendingDays` back to their balance, in the same transaction.

**Manual smoke test** against the real running dev server (beyond the
automated suite): logged in as a seeded employee, submitted a 3-day leave
request, approved it as the seeded manager, and confirmed the balance
showed exactly `usedDays: 3, pendingDays: 0`. Also smoke-tested sick leave
end-to-end: uploaded a real file via multipart, confirmed `proofStatus`
moved to `SUBMITTED`, and downloaded the file back through the signed
URL, confirming both the file content and the `Content-Disposition`
header were correct. Cleaned up all smoke-test data afterward.

## How pendingDays and usedDays change (plain language)

Think of a leave balance as having two "buckets" on top of the total
allowance: **pending** (days asked for but not yet decided) and **used**
(days actually taken). Here's what happens to those buckets at each step:

- **Submit** — the days go into `pendingDays` immediately, before any
  manager or HR has looked at the request. This is a *reservation*: it
  stops the employee from being able to overspend their balance by
  submitting several requests that together add up to more than they
  have, even if nobody has approved anything yet.
- **Approve** (at the final decision step) — the days move *from*
  `pendingDays` *into* `usedDays`. The reservation becomes a real
  deduction.
- **Reject** or **Cancel** — the days simply leave `pendingDays` and
  disappear. Nothing was ever used, so `usedDays` is untouched.
- **Revoke** (only possible on a request that was already approved, and
  only for a future date) — the days are removed from `usedDays`. They
  were already moved out of `pendingDays` back at approval time, so there
  is nothing left in `pendingDays` to touch.

Both columns can never go negative — a DB `CHECK` constraint enforces that
as a backstop, and the balance row is locked (`SELECT ... FOR UPDATE`)
inside a transaction during every one of these changes so that two
requests happening at the same instant can't both read the same stale
balance and together overspend it.

## Files changed

60 files changed, 4714 insertions(+), 111 deletions(-).

```
.gitignore                                                        |   2 +
CLAUDE.md                                                         |   8 +-
README.md                                                         |  89 +++-
apps/api/.env.example                                             |  16 +-
apps/api/.env.test.example                                        |   4 +
apps/api/package.json                                             |   5 +
apps/api/prisma/migrations/20261030125055_leave_type_allow_past_dates_and_balance_checks/migration.sql | 8 +
apps/api/prisma/schema.prisma                                     |   7 +-
apps/api/src/app.ts                                               |  10 +
apps/api/src/config.ts                                            |   7 +
apps/api/src/lib/defaultLeaveTypes.ts                             |  28 +-
apps/api/src/lib/dto.ts                                           |   6 +-
apps/api/src/lib/leaveDays.test.ts                                | 212 +++++++++
apps/api/src/lib/leaveDays.ts                                     | 124 +++++
apps/api/src/lib/notifications.ts                                 |  32 ++
apps/api/src/lib/prisma.ts                                        |  11 +-
apps/api/src/lib/prismaErrors.ts                                  |   3 +
apps/api/src/lib/storage/StorageService.ts                        |  18 +
apps/api/src/lib/storage/fileToken.test.ts                        |  40 ++
apps/api/src/lib/storage/fileToken.ts                             |  50 ++
apps/api/src/lib/storage/index.ts                                 |  34 ++
apps/api/src/lib/storage/localStorage.test.ts                     |  67 +++
apps/api/src/lib/storage/localStorage.ts                          |  64 +++
apps/api/src/lib/storage/s3Storage.test.ts                        |  76 +++
apps/api/src/lib/storage/s3Storage.ts                             |  48 ++
apps/api/src/middleware/errorHandler.ts                           |   7 +
apps/api/src/modules/auth/auth.service.ts                         |  15 +-
apps/api/src/modules/departments/departments.service.ts           |   5 +-
apps/api/src/modules/designations/designations.service.ts         |   5 +-
apps/api/src/modules/employees/employees.service.ts               |  40 ++
apps/api/src/modules/employees/employees.test.ts                  |  84 ++++
apps/api/src/modules/files/files.routes.ts                        |  39 ++
apps/api/src/modules/leaveBalances/leaveBalances.routes.ts        |  81 ++++
apps/api/src/modules/leaveBalances/leaveBalances.service.ts       | 109 +++++
apps/api/src/modules/leaveBalances/leaveBalances.test.ts          | 123 +++++
apps/api/src/modules/leaveDocuments/leaveDocuments.routes.ts      | 116 +++++
apps/api/src/modules/leaveDocuments/leaveDocuments.service.ts     | 193 ++++++++
apps/api/src/modules/leaveDocuments/leaveDocuments.test.ts        | 253 ++++++++++
apps/api/src/modules/leaveRequests/leaveDecisions.service.ts      | 286 +++++++++++
apps/api/src/modules/leaveRequests/leaveDecisions.test.ts         | 437 +++++++++++++++++
apps/api/src/modules/leaveRequests/leaveRequests.routes.ts        | 189 ++++++++
apps/api/src/modules/leaveRequests/leaveRequests.service.ts       | 333 +++++++++++++
apps/api/src/modules/leaveRequests/leaveRequests.test.ts          | 219 +++++++++
apps/api/src/modules/leaveTypes/leaveTypes.routes.ts               |  75 +++
apps/api/src/modules/leaveTypes/leaveTypes.service.ts              | 136 ++++++
apps/api/src/modules/leaveTypes/leaveTypes.test.ts                 | 101 ++++
apps/api/src/modules/users/users.routes.ts                        |  16 +-
apps/api/src/modules/users/users.service.ts                       |  40 ++
apps/api/src/modules/users/users.test.ts                          |  78 ++-
apps/api/src/test/helpers.ts                                      |  56 +++
docker-compose.yml                                                |  10 +-
docs/api-phase1.md                                                |   7 +-
docs/architecture.md                                              | 133 ++++--
docs/database-schema.md                                           |   9 +-
packages/shared/src/index.ts                                      |   4 +
packages/shared/src/leaveBalances.ts                               |  24 +
packages/shared/src/leaveDocuments.ts                              |  19 +
packages/shared/src/leaveRequests.ts                               |  59 +++
packages/shared/src/leaveTypes.ts                                  |  31 ++
pnpm-lock.yaml                                                    | 524 +++++++++++++++++++++
```

## Commands run

```
pnpm test        # apps/api, apps/web, apps/mobile, packages/shared
pnpm typecheck    # all 4 workspaces
pnpm lint         # all 4 workspaces
```

Plus manual smoke testing against a running dev server (`pnpm dev`) using
curl, covering login, leave type listing, leave request submission,
approval, sick leave document upload, HR review, and signed download —
then cleanup (stopped the dev server, truncated and reseeded the dev
database, removed the orphaned local storage directory created during
the test).

## Test results

- **135/135 tests passing** (`pnpm test`, root — all workspaces).
- **Typecheck clean** (`pnpm typecheck`, root — all 4 workspaces).
- **Lint clean** (`pnpm lint`, root — all 4 workspaces).

## Known limitations

- `apps/web` is still a placeholder — no HR/Manager dashboards yet (lands
  in Step 1.5).
- `apps/mobile` is still a placeholder workspace — no Expo app yet (lands
  in Step 1.6).
- No employee/leave-management UI — the API exists but there's no
  web/mobile screen to use it from yet.
- No in-app notification *read* endpoints yet — rows are written
  (`createNotification`) during leave events, but nothing exposes them to
  a client until Step 1.7.
- Automated proof-deadline reminders aren't implemented —
  `leave_requests.proofDueAt` is stored but nothing currently acts on it.
- `git push origin main` is still blocked locally by an SSL certificate
  issue in this environment (`unable to get local issuer certificate`).
  Per the git safety protocol, no git config change was made to work
  around it. Commit `3b413d7` (and this report's commit) are made
  locally and ready to push once that's resolved on this machine.

## Exact next step

**Step 1.5 — Web portal (HR + Manager)**: build the real React/Vite/
TanStack Query/Tailwind + shadcn/ui screens for the HR and Manager
dashboards, replacing the current placeholder `apps/web` page, wired
against the Phase 1 API that now exists end-to-end (auth, company setup,
employees, leave).
