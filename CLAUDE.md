# Employee Management SaaS — Project Guide

## Product
A multi-tenant Employee Management SaaS platform. Many companies share one system; each company's data is fully isolated.

- **Employee mobile app**: profile, leave balances, leave requests (sick leave with medical proof), check-in/out, external site visits, tasks/schedule, payslips, notifications, social feed.
- **Web portal** (one app, role-based dashboards): HR, Manager, Company Admin, plus a separate Platform Super Admin area.
- **Main sales website + online purchasing**: Phase 4 (not now).

Full requirements: `docs/proposal.md`. Read it before designing any module.

**Current focus: Phase 1 — Core Employee Management**
(auth + roles, tenant isolation, company setup, departments/designations, employees, leave types/policies/balances/requests/approvals, sick leave documents, in-app notifications, HR + Manager web screens, mobile MVP).

## Tech stack (pnpm workspaces monorepo)
```
apps/api        Node.js LTS, Express, TypeScript (strict), Prisma, PostgreSQL, Zod, Vitest + Supertest, pino
apps/web        React, TypeScript, Vite, React Router, TanStack Query, Tailwind + shadcn/ui, react-hook-form + Zod
apps/mobile     Expo (managed) + Expo Router, TanStack Query, expo-secure-store, react-hook-form + Zod
packages/shared Zod schemas, shared types, enums, permission constants (used by api, web and mobile)
docker-compose  postgres, mailpit (dev email) — file storage is a local-disk/S3 StorageService, no container needed (see docs/architecture.md §6)
```
Do not add new frameworks or major libraries without explaining why and asking first.

## Roles
`SUPER_ADMIN` (platform team), `COMPANY_ADMIN`, `HR`, `MANAGER`, `EMPLOYEE`.
- Permissions are enforced in the API. The UI only hides what the user cannot do.
- Deny by default.
- Managers see only their own team (via reporting relationships).
- SUPER_ADMIN does NOT get access to employee salary or medical documents by default.

## Non-negotiable rules
### Tenant isolation
- Every company-owned table has a `companyId` column, foreign key, and index.
- `companyId` comes ONLY from the authenticated session (token → membership). Never trust a `companyId` from the request body, query, or headers.
- All tenant data access goes through a tenant-scoped Prisma client/extension that applies the `companyId` filter automatically.
- Unique constraints are company-scoped (e.g. `@@unique([companyId, employeeCode])`).
- Every module includes cross-tenant tests: Company A must not read, edit, delete, or download Company B's data.

### Auth & security
- Passwords hashed with argon2id (or bcrypt). Never log passwords, tokens, medical files, or salary data.
- Short-lived access token plus rotating refresh token, stored hashed in the DB and revocable.
  - Mobile stores tokens in `expo-secure-store`.
  - Web uses httpOnly secure cookies.
- Login requires company code + employee ID/email + password. Login is rate-limited.
- An Employee ID alone is never a credential.
- Suspended companies and deactivated users are blocked on every request.
- Sensitive actions (approvals, role changes, balance adjustments, attendance corrections, document access) are written to `audit_logs`.

### Files
- Files are stored in private object storage via a `StorageService` abstraction (local disk in dev/test, S3 in prod). The DB stores metadata + object key only.
- Downloads use short-lived signed URLs, issued only after a permission check.
- Validate file type and size (medical proof: jpg/png/pdf, max 5 MB).

### Leave logic
- Balance checks and deductions run inside a DB transaction, so concurrent requests cannot overspend.
- Approve/reject is idempotent: an already-decided request returns a clear error.
- Validate date ranges, overlaps, half-days, working days, and holidays.

## Business defaults (configurable per company in `company_settings`)
- Leave approval workflow: `MANAGER_ONLY` (default). Option: `MANAGER_THEN_HR`.
- Sick leave proof:
  - Deadline is 3 days from the leave start date (configurable).
  - Proof can be uploaded after the request is submitted.
  - Document statuses: `PENDING_REVIEW`, `ACCEPTED`, `REJECTED`, `INFO_REQUIRED`.
- GPS verification for check-in: OFF by default, enabled per work site, default radius 200 m.
  - Location is captured only at check-in/out (foreground). Never background tracking.
- Default timezone: Asia/Colombo.
- Employee ID format: configurable prefix + number (e.g. `EMP-001`).
- Modules can be enabled or disabled per company.

## Conventions
- API base path: `/api/v1`. Error shape: `{ "error": { "code": string, "message": string, "details"?: unknown } }`
- API module layout: `apps/api/src/modules/<name>/{<name>.routes.ts, <name>.service.ts, <name>.schemas.ts, <name>.test.ts}`
- IDs are UUIDs. Timestamps are stored in UTC.
- Money is stored as `Decimal` (or integer minor units), never float.
- List endpoints are paginated (`page`, `pageSize`, max 100).
- Request/response schemas are defined once in `packages/shared` and reused by api, web, and mobile.
- No fake or placeholder features presented as complete. Mock data is allowed only in seed or demo mode.

## How to work
1. Work on ONE step at a time. Start with a short plan.
2. Before writing code for a new module, update the related doc in `docs/` if the design changes.
3. After changes, run typecheck, lint, and tests. Fix failures before moving on.
4. Never claim tests passed unless you actually ran them.
5. Never commit secrets. Keep `.env.example` up to date.
6. Commit after each working step using Conventional Commits (`feat(leave): ...`).
7. At the end of each step, report:
   - what was done
   - files changed
   - commands run
   - test results
   - known limitations
   - the exact next step
8. Save every step report to `docs/reports/step-X.md` and commit it.
9. The developer (Rashmi) is learning this stack. When you introduce a new concept or pattern, explain it briefly in plain language.
10. Push may fail on this machine due to an SSL issue; if it does, tell the developer to push manually and continue.
11. Never truncate, reset or reseed the DEV database without asking the developer first. The test database may be reset freely.

## Commands
_(Update this section as scripts are created.)_
```
docker compose up -d     # start postgres, mailpit (file storage needs no container - see README)
pnpm install
pnpm dev                 # run api + web
pnpm test
pnpm typecheck
pnpm lint
pnpm db:migrate
pnpm db:seed
pnpm --filter @employee-saas/api db:migrate:test   # apply migrations to the test DB (also runs automatically before `pnpm test`)
```

## Status
- [x] Step 0 — Design docs (architecture, ER diagram, permission matrix)
- [x] 1.1 Monorepo + Docker + Prisma + health check + seed
- [x] 1.2 Auth, roles, tenant isolation + tests
- [x] 1.3 Company setup, departments, designations, employees
- [x] 1.4 Leave module + sick leave documents
- [ ] 1.5 Web portal (HR + Manager)
- [ ] 1.6 Mobile MVP
- [ ] 1.7 In-app notifications
