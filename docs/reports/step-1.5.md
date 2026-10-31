# Step 1.5 Report — Web portal (HR, Manager, Company Admin, Super Admin)

## What was done

Built the full Phase 1 web portal in `apps/web` (previously a bare
placeholder page), in four sub-steps per `docs/prompts/step-1.5.md`,
committing after each. A progress checklist
(`docs/reports/step-1.5-progress.md`) was kept throughout so an interrupted
session could resume from the right place — it has the detailed, sub-step
by sub-step account; this report summarizes.

### 1.5a — Tooling, auth, app shell
- Tooling for `apps/web`: Tailwind v4 (CSS-first, `@tailwindcss/vite`, no
  `tailwind.config.js` needed), hand-rolled shadcn-style UI primitives on
  Radix UI + `class-variance-authority` + `clsx` + `tailwind-merge` +
  `lucide-react` (not the shadcn CLI, which needs registry network access),
  React Router v7 in plain library mode, TanStack Query, react-hook-form +
  Zod (reusing `packages/shared` schemas directly, never redefined),
  Vitest + React Testing Library + MSW.
- One API client module (`src/lib/apiClient.ts`): `fetch` with
  `credentials: "include"`, a single-flight refresh-then-retry on 401 (several
  parallel 401s share one `/auth/refresh` call), and error mapping to
  toasts/field errors.
- `/login`, `/platform/login`, a forced change-password screen, and
  role-based route guards (`RequireAuth`, `RequireRole`) that are UX-only —
  the API remains the real security boundary.
- Branding: company name/logo in the top bar, primary colour as a CSS
  variable. This needed a new `Company.primaryColor` column — no such field
  existed before.

### 1.5b — People & organisation
- Employees list (search, department/status filters, pagination), create
  employee form with an optional login (shows the temporary password once,
  with a copy button and "won't be shown again" warning), employee detail
  page (profile edit, leave balances, leave history, deactivate/reactivate,
  reset password), departments/designations CRUD, and a Users page
  (COMPANY_ADMIN full control; HR view + reset-password only, never on a
  COMPANY_ADMIN target).
- Backend additions the UI needed: `Employee.userId` exposed in responses
  (reset-password is keyed by user id, not employee id — nothing surfaced
  that mapping before), `joiningDate` fixed to serialize as `YYYY-MM-DD`,
  and an `employeeId` filter added to `GET /leave-requests` and
  `/leave-requests/team`.

### 1.5c — Leave module
- HR leave-requests page (Pending/Approved/Rejected/All tabs; employee,
  leave-type, and proof-overdue filters), a shared request detail page
  (balance snapshot, approval history, documents with HR review actions,
  approve/reject/revoke/cancel — all gated by the same decision rules the
  API enforces), the manager's team leave-requests view, "My leave"
  (balances, apply with a live total-days preview, history), leave types
  CRUD, a balance-adjustment dialog on the employee detail page, and
  holidays CRUD.
- Backend additions: `POST /leave-requests/preview` (computes `totalDays`
  for a candidate range without creating anything), `GET /leave-requests/:id`
  now also returns the `leave_approvals` history (nothing exposed this
  before), and `leaveTypeId`/`fromDate`/`toDate`/`proofOverdue` filters on
  the list endpoints.

### 1.5d — Settings, dashboards, Super Admin
- Company settings page (profile + primary colour, leave approval workflow,
  sick-leave proof deadline, a working-days editor per weekday, employee ID
  prefix), role-scoped dashboards (HR/Admin: active employees, pending
  requests, proofs overdue, on-leave-today; Manager: team pending, team
  on-leave-today), and the Super Admin area (companies list, create company
  with a one-time temporary password, suspend/reactivate with confirmation).
- Backend addition: `GET /dashboard/summary`, role-scoped, new.
- Playwright installed and Chromium downloaded successfully on this
  machine; one e2e smoke test (`apps/web/e2e/leave-approval.spec.ts`) runs
  against the real dev API: employee applies → manager approves → employee
  sees `APPROVED` and the updated balance, then cleans up by revoking the
  request. It's green.

## How pending/used/available relate (why some screens don't show a number
changing when you expect them to)

A leave balance has an `allocatedDays` pot and two live buckets,
`pendingDays` and `usedDays`. `availableDays` is always
`allocated + carriedOver - used - pending`. **Submitting** a request moves
days into `pendingDays` immediately — `available` drops right away, before
anyone decides anything. **Approving** moves those same days from
`pendingDays` to `usedDays` — `available` does **not** change again at that
point, because it already accounted for the reservation. This tripped up
the first draft of the Playwright test (see "Known limitations" below) and
is worth knowing if a screen's "available" number looks static across an
approval — that's correct, not a bug.

## Files changed

94 files changed, 6620 insertions(+), 46 deletions(-), across 5 commits
(`714065b` the CLAUDE.md rule, `2e40758` 1.5a, `70f87d9` 1.5b, `81776e7`
1.5c, `a408d83` 1.5d — the last one was captured by an automatic
session-end commit rather than my own explicit commit call, but its
contents were verified to match 1.5d's scope exactly).

New backend modules/files: `apps/api/src/modules/dashboard/*`. New shared
schemas: `packages/shared/src/dashboard.ts`, plus extensions to
`employees.ts`, `leaveRequests.ts`, `company.ts`. One new migration
(`20261031032524_add_company_primary_color`). ~50 new files under
`apps/web/src/` (routes, components, lib). New Playwright config + e2e spec.

## Commands run

```
pnpm typecheck    # all 4 workspaces — clean
pnpm lint         # all 4 workspaces — clean
pnpm --filter @employee-saas/api test     # 145/145 passing
pnpm --filter @employee-saas/web test     # 17/17 passing
pnpm --filter @employee-saas/web build    # production build succeeds
pnpm --filter @employee-saas/web test:e2e # Playwright: 1/1 passing
```

Plus manual smoke testing against the real running dev server (via curl
through the Vite proxy, and separately via the Playwright browser) for:
login (all roles), employee CRUD + reset-password, department/designation
CRUD, leave submit → approve → revoke with balance/approval-history checks,
and the dashboard summary endpoint. All test-created data was cleaned up
via the API itself afterward (revoke/deactivate) — no direct database
manipulation, per the new "never touch the dev DB directly" rule.

## Test results

- **API: 145/145 passing** (`pnpm --filter @employee-saas/api test`).
- **Web: 17/17 passing** (`pnpm --filter @employee-saas/web test`) —
  covers: login form (success + generic error), the API client's
  refresh-once-then-retry logic (including two parallel 401s → one refresh
  call), route guard by role, the temp-password dialog (shown once, cleared
  on close, can't be dismissed by accident), leave-decision rules (own
  request / manager-at-wrong-step / HR fallback, as pure-function unit
  tests mirroring the API's own rules), and the leave-apply form's
  validation + live total-days preview.
- **Playwright e2e: 1/1 passing** (`pnpm --filter @employee-saas/web test:e2e`) —
  full employee-applies → manager-approves → employee-sees-APPROVED flow
  against the real dev API, with cleanup.
- **Typecheck and lint clean** across all 4 workspaces.
- **Production build succeeds** (`vite build`; one expected bundle-size
  warning — no code-splitting yet, not a Phase 1 concern).

## Known limitations

- **No code-splitting** — one ~580 KB JS bundle. Fine for Phase 1; revisit
  with route-based `lazy()` if the app keeps growing.
- **"Pending" tab pagination**: the HR/Manager leave-requests "Pending" tab
  needs two statuses (`PENDING_MANAGER` + `PENDING_HR`), but the API's
  status filter is single-valued, so this tab fetches both (up to 100 each)
  and merges/sorts client-side, with pagination controls hidden for it
  specifically. The other tabs paginate normally server-side.
- **Filter dropdowns fetch up to 100 rows** (employee picker, leave-type
  filter, manager picker) rather than searching server-side — fine at
  Phase 1's scale (seed data has a handful of employees per company),
  revisit if a company exceeds ~100 employees or leave types.
- **The Playwright e2e test uses near-future dates (not next year)**
  because `GET /leave-balances/me` only ever returns the *current*
  calendar year's balance row — this was discovered by actually running
  the test, not assumed up front.
- A deactivated smoke-test employee (`EMP-001`, "Smoke Test") is left in
  the ACME dev company from 1.5b's manual testing — employees have no
  delete endpoint (deactivation is terminal by design), so per the new
  "don't touch the dev DB directly" rule it was left rather than deleted
  via Postgres. Harmless (inactive, excluded from active-employee lists by
  default).
- No in-app notification UI yet (Step 1.7). No mobile app yet (Step 1.6).
- `git push origin main` — see the push attempt result at the end of this
  report.

## How to try it

Start everything with `docker compose up -d` then `pnpm dev` from the repo
root, and open **http://localhost:5173**. All seeded users share the
password `Passw0rd!`.

**COMPANY_ADMIN** — sign in with company code `ACME`, `admin@acme.test`.
- Click **Employees** → **New employee** → fill in a name and joining date,
  tick "Create a login", give it an email → the temporary password dialog
  appears once.
- Click **Users** → change a role, deactivate/reactivate, reset a password.
- Click **Departments** / **Designations** → create one, try deleting one
  that's in use (clear 409 message).
- Click **Leave types** → create one; **Holidays** → add one.
- Click **Settings** → change the primary colour and save — the sidebar
  accent colour updates immediately.
- Click **Leave requests** → tabs + filters; open any request for the
  detail view.

**HR** — sign in with `ACME`, `hr@acme.test`.
- Same People/Leave screens as Company Admin, minus Settings and the
  Users role/activate controls (reset-password still works, except on the
  Company Admin's own account).
- Open a sick-leave request with a document → Accept/Reject/Request-info.

**MANAGER** — sign in with `ACME`, `manager@acme.test`.
- **Employees** shows only direct reports ("my team").
- **Leave requests** shows only the team's requests; open one and
  Approve/Reject — try it on your own request (there isn't one, by design:
  a manager's own requests go through their own manager/HR) or notice the
  button disappears once a step is already decided.
- **My leave** → apply for leave, watch the total-days preview update as
  you pick dates, submit, then cancel it from the request detail page.

**EMPLOYEE** — sign in with `ACME`, `alex@acme.test` (or `jordan@acme.test`,
`taylor@acme.test`).
- Only **My leave** is visible. Apply for leave, check the balance drops
  immediately (the reservation), then watch it get picked up by the
  manager above.

**SUPER_ADMIN** — go to **http://localhost:5173/platform/login**, sign in
with `superadmin@platform.test` (no company code).
- Click **Companies** → **New company** → see the first admin's temporary
  password once. Try **Suspend** on a company, then sign out and try
  logging into that company as its admin (blocked) before reactivating it.

## Exact next step

**Step 1.6 — Mobile MVP**: build the Expo app (currently a placeholder
workspace) against the same API — profile, leave balances, leave requests
with sick-leave document upload, and check-in/out, reusing
`packages/shared` schemas exactly as the web app does.
