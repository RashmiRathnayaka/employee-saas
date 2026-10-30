# Architecture — Phase 1

## 1. System overview

A multi-tenant SaaS platform. One deployment of the API and web app serves every
company ("tenant"). Tenant data lives in the same PostgreSQL database, in the same
tables, distinguished by a `companyId` column — this is "shared database, shared
schema" multi-tenancy, the simplest model that still gives strict isolation when the
API enforces it on every query.

```
┌─────────────┐     ┌─────────────┐
│ apps/mobile │     │  apps/web   │
│ (Expo)      │     │ (React/Vite)│
└──────┬──────┘     └──────┬──────┘
       │  HTTPS (JSON)      │  HTTPS (JSON)
       └─────────┬──────────┘
                  ▼
           ┌─────────────┐
           │  apps/api   │  Express + TypeScript
           │ /api/v1/... │
           └──────┬──────┘
                   │ Prisma Client (tenant-scoped extension)
                   ▼
           ┌─────────────┐      ┌─────────────┐
           │ PostgreSQL  │      │   MinIO     │  (private object storage —
           └─────────────┘      │ (S3 compat) │   medical docs, payslips, etc.)
                                 └─────────────┘
```

`packages/shared` holds Zod schemas, TypeScript types, enums, and permission
constants. All three apps import from it so the request/response contract is
defined exactly once.

## 2. Monorepo layout

```
apps/api        Express API — the only thing that talks to Postgres and MinIO
apps/web        React web portal (HR / Manager / Company Admin / Super Admin)
apps/mobile     Expo mobile app (Employee)
packages/shared Zod schemas, types, enums, permission constants
```

pnpm workspaces link `packages/shared` into the other three apps via
`workspace:*`, so a schema change is picked up by api/web/mobile without
publishing a package. Managed with `pnpm -w` scripts at the root.

## 3. Request flow (example: employee submits a leave request)

1. **Mobile app** calls `POST /api/v1/leave-requests` with a short-lived access
   token in the `Authorization: Bearer` header, and a body validated client-side
   against the shared Zod schema (`LeaveRequestCreateSchema` from
   `packages/shared`).
2. **Auth middleware** verifies the JWT, loads the user's current status
   (`userId`, `companyId`, `role`, `status`) from the `users` table (or a
   short-lived cache), and attaches it to `req.auth`. If the user's company
   is suspended or the user is deactivated, the request is rejected here,
   before any handler code runs.
3. **Route handler** re-validates the body with the same Zod schema (defense in
   depth — never trust the client), then calls the service layer.
4. **Service layer** uses the **tenant-scoped Prisma client**, which is
   constructed from `req.auth.companyId` — never from anything in the request
   body/query/headers. All reads/writes for company-owned tables are
   automatically filtered/stamped with that `companyId`.
5. **Single-calendar-year check**: `startDate` and `endDate` must fall in the
   same calendar year — a request spanning e.g. Dec 29 → Jan 3 is rejected
   with a validation error (the employee submits it as two requests instead).
   This keeps "which year's balance row" unambiguous for the next step.
6. **Balance check + reservation, in one transaction**: the service locks the
   employee's `leave_balances` row for the requested leave type/year
   (`SELECT ... FOR UPDATE`) — **creating it first from the leave type's
   `defaultAnnualDays` if it doesn't exist yet** (the normal path is that it
   was already created when the employee or leave type was added, see
   `docs/database-schema.md`; this is just a safety net, e.g. for a leave
   type created after the employee's balance rows were seeded for an earlier
   year) — computes `available = allocatedDays + carriedOverDays - usedDays -
   pendingDays`, and errors if `available < totalDays`. If it passes,
   `pendingDays` is incremented by `totalDays` and the `leave_requests` row is
   inserted in the same transaction — so two concurrent submissions from the
   same employee can't both pass the check against the same stale number.
7. **Status/routing at creation**: the new request's status is
   `PENDING_MANAGER` if the employee has a `managerId`, otherwise
   `PENDING_HR` directly (no manager to route to). If the leave type
   `requiresProof`, `proofStatus` is set to `MISSING` and `proofDueAt` to
   `startDate + company_settings.sickLeaveProofDeadlineDays`; otherwise
   `proofStatus` is `NOT_REQUIRED`.
8. Later, a decision (`PATCH /leave-requests/:id/approve|reject`) writes a row
   to `leave_approvals` (`step`, `approverUserId`, `decision`, `note`) and, in
   the same transaction, moves the `leave_balances` reservation and the
   request status:
   - **Manager approves** (at the `MANAGER` step, employee has a manager,
     workflow is `MANAGER_THEN_HR`) → status moves to `PENDING_HR`;
     `pendingDays` stays reserved (not yet `usedDays`).
   - **Approval at the final step for this request** — i.e. the `MANAGER`
     step under `MANAGER_ONLY`, the `HR` step under `MANAGER_THEN_HR`, **or**
     an HR fallback decision made *at* the `MANAGER` step (final — see the
     last bullet below) — moves `totalDays` from `pendingDays` to `usedDays`
     and sets status `APPROVED`.
   - **Reject at any step**, or **cancel** (by the employee, while still
     pending) — decrements `pendingDays` by `totalDays` and sets status
     `REJECTED`/`CANCELLED`. `usedDays` is untouched since nothing was ever
     moved into it.
   - **Revoke** (`PATCH /leave-requests/:id/revoke`, HR/Company Admin only,
     on an already-`APPROVED` request) — decrements `usedDays` by
     `totalDays` and sets status `REVOKED`. It does **not** touch
     `pendingDays`: those days were already moved out of `pendingDays` at
     approval time, so there's nothing left there for this request.
   - **HR deciding at the `MANAGER` step as a fallback is final** — it does
     not create a `PENDING_HR` state afterwards. Routing an HR override back
     to HR for a second look would be circular (same team, same request), so
     an HR fallback approval/rejection at the `MANAGER` step resolves the
     request immediately, the same as a final-step decision.

   The service rejects the call with a clear error if the step is already
   decided (idempotent) or if the approver's own `employeeId` matches the
   request's `employeeId` (self-approval is blocked regardless of role).
9. Every state-changing step above (submit, approve, reject, cancel, revoke,
   balance adjustment) is written to `audit_logs` in the same transaction.
10. The handler returns the created/updated resource; the manager's or HR's
    pending-approvals list and in-app notifications pick it up on their next
    fetch (Phase 1 uses polling via TanStack Query, not websockets).

Every other flow (HR creating an employee, a manager approving leave, etc.)
follows the same shape: authenticate → authorize (role + resource ownership) →
validate → execute inside the tenant boundary → audit if sensitive.

**Route registration order matters for `/employees`.** Express matches routes
in registration order, and `:id` is a wildcard segment, so `GET /employees/me`
must be registered *before* `GET /employees/:id` — otherwise `me` gets parsed
as an `:id` value and the handler tries (and fails) to look up an employee
with id `"me"`. Same rule applies anywhere a static segment (`/me`,
`/unread-count`, `/team`) sits alongside a `:id` param on the same path
prefix (`/leave-requests/team` before `/leave-requests/:id`, etc.).

**Dev-mode cookies**: the web app's Vite dev server proxies `/api/*` to
`apps/api` (configured in `apps/web/vite.config.ts`), so from the browser's
point of view the API is same-origin. That's what makes httpOnly `SameSite`
cookies work in local dev without CORS/cross-site cookie complications — in
production this becomes a reverse-proxy/same-domain deployment, not a Vite
feature.

## 4. Auth design

- **Login** requires company code + (employee code **or** email) + password
  (never the identifier alone — see CLAUDE.md). `users.email` is nullable —
  not every account needs one — so the login lookup tries employee code
  first (via `employees.employeeCode` → its linked `users` row) and falls
  back to `users.email`, both scoped to the company resolved from the company
  code. Rate-limited per IP + per company code to slow down credential
  stuffing.
- **Access token**: short-lived JWT (e.g. 15 min), signed with a server secret,
  contains `userId`, `companyId`, `role`. Stateless — any API instance can
  verify it without a DB round trip. (There's no separate `memberships`
  table in Phase 1 — a `users` row already is the one company + one role a
  user has, so there's nothing a `membershipId` would add.)
- **Refresh token**: longer-lived, random opaque string. Only its **hash** is
  stored in the DB (`refresh_tokens` table), alongside `userId`, `expiresAt`,
  `revokedAt`, and device/user-agent metadata. Rotation: every refresh issues a
  new refresh token and revokes the old one (detects token theft — reuse of a
  revoked token revokes the whole token family).
- **Storage**:
  - Web: access + refresh tokens in httpOnly, secure, `SameSite=Strict`
    cookies — not reachable from JS, so not stealable via XSS.
  - Mobile: both tokens in `expo-secure-store` (OS keychain / keystore).
- **Passwords**: hashed with argon2id. Never logged, never returned in any API
  response.
- Every authenticated request re-checks: is the user active? Is the
  company active (not suspended)? This runs on every request, not just at
  login, so an admin suspending a company or deactivating a user takes effect
  immediately.

## 5. Tenant isolation approach

This is the most important non-negotiable in the system, so the mechanism is
structural, not just "remember to add a WHERE clause":

- Every company-owned Prisma model has a required `companyId` field, a foreign
  key to `companies.id`, and an index on `companyId` (and composite indexes
  like `(companyId, employeeCode)` where there's a uniqueness rule).
- The API never constructs a tenant-scoped query by hand. Instead, all service
  code goes through a **tenant-scoped Prisma Client extension**
  (`getTenantPrisma(companyId)` in `apps/api/src/lib/prisma.ts`, Phase 1.2),
  which:
  - injects `where: { companyId }` into every `findMany`/`findFirst`/`update`/
    `delete`/`count` on tenant tables,
  - injects `data: { companyId }` on every `create`,
  - throws if a handler ever tries to use the raw (un-scoped) Prisma client for
    a tenant table outside of a handful of explicitly-reviewed exceptions
    (e.g. the Super Admin company-management endpoints, which are allowed to
    query across companies and are covered by their own role check).
- `companyId` is resolved **only** from `req.auth.companyId` (derived from the
  verified access token). Route handlers must not read a `companyId` from
  `req.body`, `req.query`, or any header — this is enforced by code review and
  by the cross-tenant test suite described below, and the shared Zod schemas
  for create/update payloads simply don't have a `companyId` field for
  tenant-table resources, so there's nothing to trust by accident.
- Row-level authorization beyond tenant (e.g. a Manager may only see employees
  who report to them) is a second, narrower filter applied in the service
  layer on top of the tenant scope — tenant isolation first, then role-based
  narrowing.
- **Cross-tenant tests**: every module's test file includes at least one test
  that creates data as Company A and asserts Company B's token gets a 404 (not
  a 403 — we don't want to confirm the resource exists) for read, update,
  delete, and file-download endpoints.

## 6. Files (sick leave documents, payslips, etc.)

- Files live in MinIO (S3-compatible), in a bucket layout keyed by company and
  module, e.g. `company/<companyId>/leave-documents/<leaveRequestId>/<fileId>`.
- The DB stores only metadata: object key, original filename, content type,
  size, uploader, status. Never the file bytes.
- **Upload goes through the API, not a client-to-MinIO pre-signed PUT.** The
  client sends a `multipart/form-data` request straight to
  `POST /leave-requests/:id/documents`. The API, in order:
  1. checks the caller is permitted to upload to *this* leave request
     (owner, within the tenant),
  2. enforces the size limit (max 5 MB) at the multipart-parser level so an
     oversized body is rejected before it's fully buffered,
  3. validates the declared content type against the allow-list
     (`jpg`/`png`/`pdf`), **then re-checks the actual file content by magic
     bytes** (e.g. via `file-type`) — a renamed `.exe` with a `.pdf` extension
     and a claimed `application/pdf` content type is rejected, since the
     declared type is not trusted on its own,
  4. streams the validated file to MinIO under a server-generated object key,
  5. writes the `leave_request_documents` metadata row.

  Routing uploads through the API (rather than a direct-to-MinIO pre-signed
  PUT) keeps validation server-side and in one place, and avoids exposing
  MinIO's endpoint to the client — simpler to get right for a 5 MB document
  upload than the pre-signed-PUT pattern is worth in Phase 1.
- **Download** still uses short-lived signed URLs, not a proxied byte stream:
  the client asks the API for the file; the API checks the requester is
  allowed to see *this* file for *this* tenant, then returns a signed GET URL
  (a few minutes' expiry).
- **Two S3 clients, not one, because a SigV4 signature covers the host.**
  Rewriting the host of an already-signed URL breaks it
  (`SignatureDoesNotMatch`), since the signature is computed over the
  request including the `Host` header. So the API holds:
  - a **main client**, configured with `S3_ENDPOINT`, used for every
    server-to-MinIO operation (uploads, metadata) — in dev this is
    `http://localhost:9000`, since `pnpm dev` runs the API directly on the
    host (not inside the Docker network), so `localhost` is correct, not the
    Docker Compose service name `minio`;
  - a **presigning client**, configured with `endpoint = S3_PUBLIC_URL` and
    used *only* to generate the GET URL returned to clients — in dev this is
    the machine's LAN IP (e.g. `http://192.168.x.x:9000`), since a phone
    running the Expo app can't resolve `localhost` as "this computer"; in
    prod it's the real public/CDN endpoint for the bucket.

  Both clients point at the same MinIO instance and the same credentials —
  only the `endpoint` differs — so this is a few lines of S3-client setup in
  `apps/api/src/lib/storage.ts`, not two separate services.
- The object key is never guessable from outside (UUIDs), and the bucket
  itself is private — only the API's credentials can mint signed URLs.

## 7. Notifications (Phase 1 scope: in-app only)

An `notifications` table, company- and user-scoped, written whenever a
relevant event happens (leave submitted → notify manager; leave
approved/rejected → notify employee). The web/mobile clients poll
`GET /api/v1/notifications` via TanStack Query. Push/email are Phase 2+.

## 8. Environments

- **Dev**: `docker-compose.yml` runs Postgres, MinIO, and Mailpit (catches
  outbound email locally — not used for real sending until a later phase).
- Config is loaded from `.env` and validated with Zod at boot (`apps/api/src/config.ts`)
  so a missing/malformed env var fails fast with a clear error instead of a
  confusing runtime crash later.
