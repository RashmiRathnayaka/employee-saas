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

# 3. Copy the API env file and adjust if needed (defaults match docker-compose.yml)
cp apps/api/.env.example apps/api/.env

# 4. Generate the Prisma client, create the database schema
pnpm --filter @employee-saas/api db:generate
pnpm db:migrate

# 5. Seed demo data (2 companies, each with an admin, HR, manager, 3 employees)
pnpm db:seed
```

## Running

```bash
pnpm dev        # runs the API (http://localhost:4000) and the web app (http://localhost:5173)
pnpm test       # runs all workspace test suites (apps/api needs docker compose up first)
pnpm typecheck  # tsc --noEmit across all workspaces
pnpm lint       # eslint across all workspaces
```

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

| Company code | Role | Email |
|---|---|---|
| ACME | COMPANY_ADMIN | admin@acme.test |
| ACME | HR | hr@acme.test |
| ACME | MANAGER | manager@acme.test |
| ACME | EMPLOYEE | alex@acme.test, jordan@acme.test, taylor@acme.test |
| BETA | COMPANY_ADMIN | admin@beta.test |
| BETA | HR | hr@beta.test |
| BETA | MANAGER | manager@beta.test |
| BETA | EMPLOYEE | alex@beta.test, jordan@beta.test, taylor@beta.test |

## Mobile (Expo) on a LAN device

`apps/api/.env`'s `S3_PUBLIC_URL` defaults to `http://localhost:9000`, which
only works from the same machine. Once MinIO and `apps/mobile` are both built
out, set it to your machine's LAN IP (e.g. `http://192.168.1.50:9000`) so a
phone on the same network can resolve signed file-download URLs.

## Known limitations (Step 1.1)

- `apps/web` is a placeholder Vite/React page — HR/Manager dashboards land in Step 1.5.
- `apps/mobile` is a placeholder workspace package (no Expo app yet) — lands in Step 1.6.
- No auth, employee, or leave endpoints yet — only `/api/v1/health`. Those are Steps 1.2–1.4.
- MinIO isn't running yet (see above) — file upload/download code also lands in Step 1.4.
