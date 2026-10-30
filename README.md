# Employee Management SaaS

Multi-tenant Employee Management SaaS platform. See `CLAUDE.md` for the project
guide and `docs/` for the Phase 1 design (architecture, database schema,
permissions, API).

## Stack

```
apps/api        Node.js, Express, TypeScript (strict), Prisma, PostgreSQL, Zod, Vitest
apps/web        React, TypeScript, Vite, React Router (Step 1.5)
apps/mobile     Expo (Step 1.6) — placeholder package for now
packages/shared Zod schemas, shared types, enums (used by api, web, mobile)
```

## Prerequisites

- Node.js 20+ (tested with v22)
- pnpm (tested with 12.16.1) — `npm install -g pnpm` if you don't have it
- Docker Desktop (for Postgres and Mailpit; see the MinIO note below)

## First-time setup

```bash
# 1. Start Postgres and Mailpit
docker compose up -d

# 2. Install all workspace dependencies
pnpm install

# 3. Copy the API env files and adjust if needed (defaults match docker-compose.yml)
cp apps/api/.env.example apps/api/.env
cp apps/api/.env.test.example apps/api/.env.test

# 4. Generate the Prisma client, create the dev database schema
pnpm --filter @employee-saas/api db:generate
pnpm db:migrate

# 5. Seed demo data (2 companies, each with an admin, HR, manager, 3 employees, plus 1 platform super admin)
pnpm db:seed
```

## Running

```bash
pnpm dev        # runs the API (http://localhost:4000) and the web app (http://localhost:5173)
pnpm test       # runs all workspace test suites (apps/api needs docker compose up first)
pnpm typecheck  # tsc --noEmit across all workspaces
pnpm lint       # eslint across all workspaces
```

## Running tests (separate database)

Tests never touch the dev database - they run against `employee_saas_test`,
a separate database on the same Postgres container (created automatically by
`scripts/postgres-init/001-create-test-db.sql` on a fresh `docker compose up`;
if you started the container before this existed, create it once with
`docker compose exec postgres psql -U employee_saas -d employee_saas -c "CREATE DATABASE employee_saas_test OWNER employee_saas"`).

`apps/api/.env.test` points at that database. Running `pnpm test` (inside
`apps/api`) automatically applies any pending migrations to it first (via a
`pretest` script), then runs Vitest. Every single test also truncates all
tables before it runs (a global `beforeEach` in `src/test/setupDb.ts`), so
tests never see leftover data from a previous test, dev data, or seed data -
each test starts from a completely empty database and sets up whatever rows
it needs.

Health check: `GET http://localhost:4000/api/v1/health` — returns `{ "status": "ok", "db": "ok", "timestamp": "..." }`
if the API can reach Postgres.

Mailpit UI: http://localhost:8025.

## MinIO (deferred)

`docker-compose.yml` does not run MinIO yet: as of this writing, pulling
`minio/minio` requires an authenticated Docker Hub or quay.io login (MinIO's
2024 licensing change) on every tag we tried, both plain `latest` and pinned
`RELEASE.*` tags. It needs to go back in before Step 1.4 (file uploads) —
either with a Docker Hub/quay.io login that has access, or swapped for an
S3-compatible alternative (e.g. LocalStack, which pulls anonymously without
issue) if that restriction is still in place then.

## Seeded accounts

All seeded users share the password `Passw0rd!`. Company codes: `ACME`, `BETA`.
HR and Manager are also employees (with their own leave balances) - only
Company Admin has no employee profile. Login identifier can be the email
*or* the employee code shown below.

| Company code | Role | Email | Employee code |
|---|---|---|---|
| ACME | COMPANY_ADMIN | admin@acme.test | — |
| ACME | HR | hr@acme.test | ACM-EMP-001 |
| ACME | MANAGER | manager@acme.test | ACM-EMP-002 |
| ACME | EMPLOYEE | alex@acme.test | ACM-EMP-003 |
| ACME | EMPLOYEE | jordan@acme.test | ACM-EMP-004 |
| ACME | EMPLOYEE | taylor@acme.test | ACM-EMP-005 |
| BETA | COMPANY_ADMIN | admin@beta.test | — |
| BETA | HR | hr@beta.test | BETA-EMP-001 |
| BETA | MANAGER | manager@beta.test | BETA-EMP-002 |
| BETA | EMPLOYEE | alex@beta.test | BETA-EMP-003 |
| BETA | EMPLOYEE | jordan@beta.test | BETA-EMP-004 |
| BETA | EMPLOYEE | taylor@beta.test | BETA-EMP-005 |

Platform-level account - log in with **no company code**, email only:

| Role | Email |
|---|---|
| SUPER_ADMIN | superadmin@platform.test |

## Auth (Step 1.2)

`POST /api/v1/auth/login` takes `{ companyCode, identifier, password }` -
`identifier` is either an employee code or an email, scoped to the company
resolved from `companyCode`. The platform `SUPER_ADMIN` account has no
company, so it logs in by omitting `companyCode` entirely (email only).
Every failure (unknown company, unknown identifier, wrong password,
deactivated user, suspended company) returns the exact same `401
INVALID_CREDENTIALS` response, so a caller can't use the error to figure out
which part was wrong. Login is rate-limited per IP + company code.

**Web vs. mobile clients** - send the header `X-Client: mobile` to get the
mobile behavior; omit it for the default (web) behavior:

- **Web** (default): access + refresh tokens are set as httpOnly, `SameSite=Strict`
  cookies (`Secure` in production). The browser sends them automatically;
  the response body never contains a token. This is the safer option for a
  browser, since JS on the page (including injected XSS payloads) can never
  read an httpOnly cookie.
- **Mobile** (`X-Client: mobile`): there's no browser cookie jar on a React
  Native app, so tokens are returned in the JSON response body instead. The
  app stores them in `expo-secure-store` (OS keychain/keystore) and sends
  the access token as `Authorization: Bearer <token>` on every request, and
  the refresh token in the body when calling `/auth/refresh`.

Access tokens are short-lived JWTs (15 min, claims: `userId`, `companyId`,
`role`). Refresh tokens are long-lived (30 days) random strings - the DB
only ever stores a SHA-256 hash of one, never the token itself. See the
report for Step 1.2 for a plain-language explanation of refresh rotation.

## Mobile (Expo) on a LAN device

`apps/api/.env`'s `S3_PUBLIC_URL` defaults to `http://localhost:9000`, which
only works from the same machine. Once MinIO and `apps/mobile` are both built
out, set it to your machine's LAN IP (e.g. `http://192.168.1.50:9000`) so a
phone on the same network can resolve signed file-download URLs.

## Known limitations

- `apps/web` is a placeholder Vite/React page — HR/Manager dashboards land in Step 1.5.
- `apps/mobile` is a placeholder workspace package (no Expo app yet) — lands in Step 1.6.
- No employee or leave endpoints yet — only `/api/v1/health` and `/api/v1/auth/*`. Employees/departments land in Step 1.3, leave in Step 1.4.
- MinIO isn't running yet (see above) — file upload/download code also lands in Step 1.4.
- No employee-management UI to assign roles/managers yet — seed data is the only way to get test accounts for now.
