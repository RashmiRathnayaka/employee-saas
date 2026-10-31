# Step 1.5 progress checklist

Read this first if a session was cleared or interrupted — it says exactly
where to pick up. Update it as sub-steps complete. Source of truth for scope:
`docs/prompts/step-1.5.md`.

## 0. Before starting
- [x] Added "never truncate/reseed DEV DB without asking" rule to CLAUDE.md (commit `714065b`)
- [x] This progress file created

## 1.5a — Auth + app shell — DONE
- [x] Tooling: Tailwind v4, shadcn-style primitives (Radix + cva + clsx + tailwind-merge), React Router v7, TanStack Query, react-hook-form + Zod, Vitest + RTL + MSW
- [x] Strings file (`src/strings.ts`)
- [x] API client module (`src/lib/apiClient.ts`): fetch w/ credentials, 401 → refresh-once-then-retry (single in-flight refresh), error→toast/field-error mapping (`src/lib/errorMapping.ts`)
- [x] Toast system (`src/lib/toast.tsx`)
- [x] `/login` (company code + identifier + password, generic error on failure)
- [x] Forced change-password screen (mustChangePassword gate, in `RequireAuth`)
- [x] `/platform/login` (SUPER_ADMIN)
- [x] App shell: sidebar by role, top bar (company name, user menu, logout), 404 page
- [x] Route guards: logged-out → login, wrong role → "not allowed" (`RequireAuth`/`RequireRole` in `layout/RouteGuard.tsx`)
- [x] Branding: primary colour CSS var + company name/logo in top bar - **added `Company.primaryColor` column** (migration `20261031032524_add_company_primary_color`; nullable, no default field existed before, see shared `CompanySchema`/`UpdateCompanyProfileRequestSchema`)
- [x] Tests: login form (8 tests total across 3 files), refresh-once logic (incl. parallel 401s), route guard by role - all passing
- [x] typecheck/lint/test clean (web: 8/8; api: 135/135 unaffected), committed

Notable decisions:
- Tailwind v4 (CSS-first, `@tailwindcss/vite` plugin, no `tailwind.config.js` needed).
- React Router v7 in plain "library mode" (`<BrowserRouter>`/`<Routes>`), not its data-router/framework mode - keeps it a plain Vite SPA.
- shadcn/ui components are hand-rolled (not the shadcn CLI, which needs network access to a registry and scaffolds files interactively) using the same underlying primitives shadcn uses: Radix UI + `class-variance-authority` + `clsx` + `tailwind-merge` + `lucide-react`.
- `jsdom` pinned to `^29` (not latest `30`) because `jsdom@30` depends on `undici@^8.7.0`, which requires Node `>=22.19.0`; this machine runs Node `22.14.0`. `jsdom@29` depends on `undici@^7`, which only requires Node `>=20.18.1`.
- Had to stop a leftover `pnpm dev` process (tsx watch on the API) because it held `query_engine-windows.dll.node` locked, blocking `prisma generate` after the migration. Flagged to the developer below - restart `pnpm dev` if you had it running for another reason.
- `msw` needed a build-script approval entry added to `pnpm-workspace.yaml` (`allowBuilds`/`onlyBuiltDependencies`).

## 1.5b — People & organisation (HR, COMPANY_ADMIN)
- [ ] Employees list (search/filter/pagination)
- [ ] Create employee form + one-time temp password dialog
- [ ] Employee detail (profile, balances, history, edit, deactivate, reset password)
- [ ] Departments/designations CRUD tables (409-in-use handling)
- [ ] Users page (COMPANY_ADMIN): list/role/activate/deactivate/reset password, "last admin" error
- [ ] Tests: temp password dialog shown once
- [ ] typecheck/lint/test clean, commit

## 1.5c — Leave
- [ ] HR leave requests page (tabs, filters, proof overdue filter)
- [ ] Request detail (dates, balance before/after, approval history, documents, approve/reject/revoke)
- [ ] Manager: my team + team leave requests w/ approve/reject
- [ ] My leave: balances, apply (+ days-preview endpoint if missing, with tests), history, cancel, upload doc
- [ ] Leave types CRUD
- [ ] Balance adjustment dialog
- [ ] Holidays list/add/delete
- [ ] Tests: approve/reject hidden on own request / manager-at-HR-step, leave apply validation
- [ ] typecheck/lint/test clean, commit

## 1.5d — Settings, dashboards, Super Admin
- [ ] Company settings page
- [ ] Dashboards (HR/Admin, Manager) — add `GET /dashboard/summary` if missing (with tests incl. cross-tenant + manager-scope)
- [ ] Super Admin: companies list, create company, suspend/reactivate
- [ ] Playwright smoke test (skip + note if browser download fails)
- [ ] README update (how to run web, URL, seeded logins per role)
- [ ] CLAUDE.md status update
- [ ] Full workspace typecheck/lint/test
- [ ] commit, attempt push
- [ ] Write `docs/reports/step-1.5.md`

## Key facts gathered (so a fresh session doesn't need to re-derive them)
- `apps/web` was a bare placeholder (App.tsx, main.tsx, vite.config.ts with
  `/api` → `localhost:4000` proxy already set up). No Tailwind/router/query/
  forms yet.
- Auth endpoints: `POST /auth/login` `{companyCode, identifier, password}`,
  `POST /auth/platform/login` `{email, password}`, `POST /auth/refresh`
  (cookie-based, no body needed from web), `POST /auth/logout`,
  `POST /auth/change-password` `{currentPassword, newPassword}`, `GET /auth/me`.
  Web is cookie-based (not `X-Client: mobile`), so login/refresh responses
  carry no tokens in the body — cookies are set by the API directly.
  `mustChangePassword=true` → every route except `/auth/change-password`
  returns `403 PASSWORD_CHANGE_REQUIRED`.
- Seeded logins (password `Passw0rd!` for everyone):
  - Super admin (platform login, no company code): `superadmin@platform.test`
  - Company `ACME`: `admin@acme.test` (COMPANY_ADMIN), `hr@acme.test` (HR),
    `manager@acme.test` (MANAGER), `alex@acme.test` / `jordan@acme.test` /
    `taylor@acme.test` (EMPLOYEE, report to manager@acme.test)
  - Company `BETA`: same pattern with `@beta.test`
- No `GET /dashboard/summary` endpoint exists yet — must be added in 1.5d.
- No `POST` leave-days-preview endpoint exists yet — must be added in 1.5c for
  the "show total days before submitting" requirement.
- Full endpoint list confirmed by reading every `*.routes.ts` under
  `apps/api/src/modules` directly (don't fully trust `docs/api-phase1.md`
  for exact behavior nuances, though paths matched).
- Error shape: `{ error: { code, message, details? } }`. Relevant codes seen:
  `UNAUTHENTICATED` (401), `PASSWORD_CHANGE_REQUIRED` (403),
  `VALIDATION_ERROR` (400, has `details` from `ZodError.flatten()`),
  `FORBIDDEN` (403), `NOT_FOUND` (404), `FILE_TOO_LARGE`/`UPLOAD_ERROR` (400).
- `CompanySettings` fields: `leaveApprovalWorkflow` (`MANAGER_ONLY`|
  `MANAGER_THEN_HR`), `sickLeaveProofDeadlineDays`, `gpsCheckinEnabledDefault`,
  `gpsRadiusMeters`, `employeeIdPrefix`, `enabledModules` (JSON),
  `workingDays` (JSON, `{mon: "FULL"|"HALF"|"OFF", ...}`).
