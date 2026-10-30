# API — Phase 1 endpoint list

Base path: `/api/v1`. All request/response bodies are defined once in
`packages/shared` as Zod schemas. Error shape:
`{ "error": { "code": string, "message": string, "details"?: unknown } }`.
List endpoints accept `page`, `pageSize` (max 100) and return
`{ "data": [...], "page", "pageSize", "total" }`.

"Role" is the minimum role(s) allowed to call the endpoint; see
`docs/permissions.md` for the full scoping rules (e.g. Manager = own team
only). Every row below is also subject to tenant isolation
(`companyId` from the token) regardless of role.

## Auth

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/auth/login` | public | Log in with company code + (employee code or email) + password (company code required); returns access + refresh tokens |
| POST | `/auth/platform/login` | public | `SUPER_ADMIN`-only login: email + password, no company code. Separate endpoint, separate (stricter, IP-only) rate limit |
| POST | `/auth/refresh` | authenticated (refresh token) | Rotate refresh token, issue a new access token |
| POST | `/auth/logout` | any | Revoke the current refresh token |
| POST | `/auth/change-password` | any | Change own password |
| GET | `/auth/me` | any | Return current user + role + company + (if applicable) employee profile |

`/auth/login` requires `companyCode` — there is no company-code-optional
path. `SUPER_ADMIN` accounts have no company, so they never use
`/auth/login`; they use `/auth/platform/login` instead, which only ever
matches `SUPER_ADMIN` accounts and is rate-limited more tightly (5/15min per
IP, vs. 10/15min per IP+company-code) since a compromised platform account
can affect every company on the platform. **MFA for platform admin accounts
is planned for Phase 4** (not implemented in Phase 1) — until then, this
tighter rate limit plus a strong generated password is the only extra
protection on this endpoint.

Until the password is changed, a user flagged `mustChangePassword` (set on
any newly-created login) gets `403 PASSWORD_CHANGE_REQUIRED` from every
endpoint except `POST /auth/change-password` — including both login
endpoints' *subsequent* calls and `GET /auth/me` (the flag itself is
returned in the login response body, so a client doesn't need `/auth/me` to
discover it immediately after logging in).

## Companies (platform / Super Admin)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/companies` | SUPER_ADMIN | Create a new company + its initial Company Admin user |
| GET | `/companies` | SUPER_ADMIN | List all companies (platform-wide) |
| GET | `/companies/:id` | SUPER_ADMIN | View one company's account/status |
| PATCH | `/companies/:id/status` | SUPER_ADMIN | Suspend / reactivate a company |

## Company profile & settings (own company)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/company` | any | View own company profile |
| PATCH | `/company` | COMPANY_ADMIN | Edit company profile/branding |
| GET | `/company/settings` | any | View own company's settings (leave workflow, GPS defaults, employee ID format, enabled modules) |
| PATCH | `/company/settings` | COMPANY_ADMIN | Edit company settings |
| GET | `/company/holidays` | any | List company holidays |
| POST | `/company/holidays` | COMPANY_ADMIN, HR | Add a holiday |
| DELETE | `/company/holidays/:id` | COMPANY_ADMIN, HR | Remove a holiday |

## Users

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/users` | COMPANY_ADMIN, HR | List user accounts in own company |
| POST | `/users` | COMPANY_ADMIN | Create a user account and assign a role |
| PATCH | `/users/:id` | COMPANY_ADMIN | Change a user's role / reset password |
| PATCH | `/users/:id/status` | COMPANY_ADMIN | Deactivate / reactivate a user |

## Departments

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/departments` | any | List departments |
| POST | `/departments` | COMPANY_ADMIN, HR | Create a department |
| PATCH | `/departments/:id` | COMPANY_ADMIN, HR | Rename a department |
| DELETE | `/departments/:id` | COMPANY_ADMIN, HR | Delete a department (blocked if employees reference it) |

## Designations

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/designations` | any | List designations |
| POST | `/designations` | COMPANY_ADMIN, HR | Create a designation |
| PATCH | `/designations/:id` | COMPANY_ADMIN, HR | Rename a designation |
| DELETE | `/designations/:id` | COMPANY_ADMIN, HR | Delete a designation (blocked if employees reference it) |

## Employees

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/employees` | COMPANY_ADMIN, HR, MANAGER | List employees (Manager: own team only) |
| POST | `/employees` | COMPANY_ADMIN, HR | Create an employee profile (optionally with a login) |
| GET | `/employees/:id` | COMPANY_ADMIN, HR, MANAGER (own team), EMPLOYEE (self) | View one employee profile |
| PATCH | `/employees/:id` | COMPANY_ADMIN, HR | Edit an employee profile (department, designation, manager, status) |
| PATCH | `/employees/me` | any employee | Edit own contact info / photo |
| PATCH | `/employees/:id/status` | COMPANY_ADMIN, HR | Deactivate / reactivate an employee |
| GET | `/employees/me` | any employee | View own profile |

## Leave types

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/leave-types` | any | List leave types |
| POST | `/leave-types` | COMPANY_ADMIN, HR | Create a leave type |
| PATCH | `/leave-types/:id` | COMPANY_ADMIN, HR | Edit a leave type |
| DELETE | `/leave-types/:id` | COMPANY_ADMIN, HR | Delete a leave type (blocked if balances/requests reference it) |

## Leave balances

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/leave-balances/me` | any employee | View own balances (current year) |
| GET | `/employees/:id/leave-balances` | COMPANY_ADMIN, HR, MANAGER (own team) | View an employee's balances |
| POST | `/employees/:id/leave-balances/adjust` | COMPANY_ADMIN, HR | Manually adjust a balance (writes an audit log entry) |

## Leave requests

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/leave-requests` | any employee | Submit a leave request for self |
| GET | `/leave-requests/me` | any employee | List own leave requests |
| GET | `/leave-requests/team` | MANAGER | List requests from direct reports |
| GET | `/leave-requests` | COMPANY_ADMIN, HR | List all requests in own company |
| GET | `/leave-requests/:id` | owner, their MANAGER, COMPANY_ADMIN, HR | View one request |
| PATCH | `/leave-requests/:id/cancel` | request owner | Cancel own pending request (decrements `pendingDays`) |
| PATCH | `/leave-requests/:id/approve` | MANAGER (own team, MANAGER step), HR (HR step, or MANAGER step as fallback) | Approve the current step (idempotent — errors if that step is already decided, or if the caller is the requester) |
| PATCH | `/leave-requests/:id/reject` | MANAGER (own team, MANAGER step), HR (HR step, or MANAGER step as fallback) | Reject the current step (idempotent — errors if that step is already decided, or if the caller is the requester) |
| PATCH | `/leave-requests/:id/revoke` | COMPANY_ADMIN, HR | Revoke an already-approved future leave: decrements `usedDays` by the request's `totalDays` (does not touch `pendingDays`), sets status `REVOKED`, writes an audit log entry |

## Sick leave documents

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/leave-requests/:id/documents` | request owner | Upload a file directly (`multipart/form-data`, max 5 MB, jpg/png/pdf — validated by declared type and by magic bytes); API streams it to MinIO and creates the metadata row |
| GET | `/leave-requests/:id/documents` | owner, COMPANY_ADMIN, HR | List documents on a request |
| GET | `/leave-requests/:id/documents/:docId/download` | owner, COMPANY_ADMIN, HR | Get a short-lived signed download URL (built from `S3_PUBLIC_URL`) |
| PATCH | `/leave-requests/:id/documents/:docId/review` | HR | Set status (Accepted / Rejected / Info Required) + note; updates the parent request's `proofStatus` |

## Notifications

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/notifications` | any | List own notifications (paginated, newest first) |
| GET | `/notifications/unread-count` | any | Count of unread notifications |
| PATCH | `/notifications/:id/read` | any (own only) | Mark one notification read |
| PATCH | `/notifications/read-all` | any | Mark all own notifications read |

## Audit logs

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/audit-logs` | COMPANY_ADMIN (full), HR (filtered to leave/balance entity types only) | List audit log for own company (filterable by entity/action/date) |
| GET | `/platform/audit-logs` | SUPER_ADMIN | List audit log across all companies |

## Health

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/health` | public | Liveness + DB connectivity check |
