# Database Schema — Phase 1

Phase 1 tables only (company setup, auth/roles, employees, departments/designations,
leave types/policies/balances/requests/approvals, sick leave documents, in-app
notifications, audit log). Attendance, payroll, and social-feed tables arrive in
later phases.

Conventions used throughout: `id` is `UUID` (`gen_random_uuid()`), all timestamps
are `TIMESTAMPTZ` stored in UTC, money would be `DECIMAL` (none in Phase 1), every
company-owned table has `companyId UUID NOT NULL REFERENCES companies(id)` plus an
index on it.

## ER diagram

```mermaid
erDiagram
    COMPANIES ||--o| COMPANY_SETTINGS : has
    COMPANIES ||--o{ DEPARTMENTS : has
    COMPANIES ||--o{ DESIGNATIONS : has
    COMPANIES ||--o{ EMPLOYEES : has
    COMPANIES ||--o{ USERS : has
    COMPANIES ||--o{ LEAVE_TYPES : has
    COMPANIES ||--o{ COMPANY_HOLIDAYS : has
    COMPANIES ||--o{ AUDIT_LOGS : has

    DEPARTMENTS ||--o{ EMPLOYEES : contains
    DESIGNATIONS ||--o{ EMPLOYEES : contains
    EMPLOYEES ||--o{ EMPLOYEES : "manages (self FK)"
    EMPLOYEES ||--o| USERS : "has login"
    EMPLOYEES ||--o{ LEAVE_BALANCES : has
    EMPLOYEES ||--o{ LEAVE_REQUESTS : submits

    USERS ||--o{ REFRESH_TOKENS : has
    USERS ||--o{ NOTIFICATIONS : receives
    USERS ||--o{ AUDIT_LOGS : "performs (actor)"
    USERS ||--o{ LEAVE_APPROVALS : "decides (approverUserId)"
    USERS ||--o{ LEAVE_REQUESTS : "revokes (revokedBy)"
    USERS ||--o{ LEAVE_REQUEST_DOCUMENTS : "reviews (reviewedBy)"

    LEAVE_TYPES ||--o{ LEAVE_BALANCES : "balance for"
    LEAVE_TYPES ||--o{ LEAVE_REQUESTS : "request for"
    LEAVE_REQUESTS ||--o{ LEAVE_REQUEST_DOCUMENTS : "supporting docs"
    LEAVE_REQUESTS ||--o{ LEAVE_APPROVALS : "has decision steps"

    COMPANIES {
        uuid id PK
        string name
        string code "unique, used at login"
        string logoUrl
        string status "ACTIVE | SUSPENDED"
        string timezone "default Asia/Colombo"
        timestamptz createdAt
        timestamptz updatedAt
    }

    COMPANY_SETTINGS {
        uuid companyId PK_FK
        string leaveApprovalWorkflow "MANAGER_ONLY | MANAGER_THEN_HR"
        int sickLeaveProofDeadlineDays "default 3"
        boolean gpsCheckinEnabledDefault "default false"
        int gpsRadiusMeters "default 200"
        string employeeIdPrefix
        int employeeIdNextNumber
        jsonb enabledModules
        jsonb workingDays "default Mon-Fri full day, Sat half day, Sun off"
        timestamptz updatedAt
    }

    DEPARTMENTS {
        uuid id PK
        uuid companyId FK
        string name
        timestamptz createdAt
    }

    DESIGNATIONS {
        uuid id PK
        uuid companyId FK
        string name
        timestamptz createdAt
    }

    EMPLOYEES {
        uuid id PK
        uuid companyId FK
        string employeeCode "unique per company"
        string firstName
        string lastName
        string photoUrl
        string phone
        uuid departmentId FK
        uuid designationId FK
        uuid managerId FK "self -> employees.id, nullable"
        date joiningDate
        string status "ACTIVE | INACTIVE"
        timestamptz createdAt
        timestamptz updatedAt
    }

    USERS {
        uuid id PK
        uuid companyId FK "null only for SUPER_ADMIN"
        uuid employeeId FK "unique, nullable (null for non-employee roles)"
        string email "nullable; unique per company when present"
        string passwordHash
        string role "SUPER_ADMIN|COMPANY_ADMIN|HR|MANAGER|EMPLOYEE"
        string status "ACTIVE | DEACTIVATED"
        timestamptz lastLoginAt
        timestamptz createdAt
        timestamptz updatedAt
    }

    REFRESH_TOKENS {
        uuid id PK
        uuid userId FK
        string tokenHash "sha256 of the opaque token"
        timestamptz expiresAt
        timestamptz revokedAt
        uuid replacedByTokenId "nullable, self FK"
        string userAgent
        timestamptz createdAt
    }

    LEAVE_TYPES {
        uuid id PK
        uuid companyId FK
        string name
        string code "unique per company"
        decimal defaultAnnualDays
        boolean requiresProof "e.g. true for sick leave"
        boolean carryForwardAllowed
        timestamptz createdAt
    }

    COMPANY_HOLIDAYS {
        uuid id PK
        uuid companyId FK
        date date "unique per company"
        string name
    }

    LEAVE_BALANCES {
        uuid id PK
        uuid companyId FK
        uuid employeeId FK
        uuid leaveTypeId FK
        int year
        decimal allocatedDays
        decimal usedDays "default 0"
        decimal pendingDays "default 0 — reserved by not-yet-decided requests"
        decimal carriedOverDays "default 0"
        timestamptz updatedAt
    }

    LEAVE_REQUESTS {
        uuid id PK
        uuid companyId FK
        uuid employeeId FK
        uuid leaveTypeId FK
        date startDate
        date endDate
        boolean startHalfDay
        boolean endHalfDay
        decimal totalDays "computed at submit time"
        text reason
        string status "PENDING_MANAGER|PENDING_HR|APPROVED|REJECTED|CANCELLED|REVOKED"
        string proofStatus "NOT_REQUIRED|MISSING|SUBMITTED|ACCEPTED|REJECTED|INFO_REQUIRED"
        timestamptz proofDueAt "nullable; startDate + company sickLeaveProofDeadlineDays"
        uuid revokedBy FK "-> users.id, nullable"
        timestamptz revokedAt
        text revokeNote
        timestamptz createdAt
        timestamptz updatedAt
    }

    LEAVE_APPROVALS {
        uuid id PK
        uuid companyId FK
        uuid leaveRequestId FK
        string step "MANAGER | HR"
        uuid approverUserId FK "-> users.id"
        string decision "APPROVED | REJECTED"
        text note
        timestamptz decidedAt
    }

    LEAVE_REQUEST_DOCUMENTS {
        uuid id PK
        uuid companyId FK
        uuid leaveRequestId FK
        string objectKey "MinIO key, not a path the client controls"
        string filename
        string contentType
        int sizeBytes
        string status "PENDING_REVIEW|ACCEPTED|REJECTED|INFO_REQUIRED"
        uuid reviewedBy FK "-> users.id, nullable"
        timestamptz reviewedAt
        text reviewNote
        timestamptz uploadedAt
    }

    NOTIFICATIONS {
        uuid id PK
        uuid companyId FK
        uuid userId FK "recipient"
        string type
        string title
        string body
        string relatedEntityType "nullable"
        uuid relatedEntityId "nullable"
        timestamptz readAt
        timestamptz createdAt
    }

    AUDIT_LOGS {
        uuid id PK
        uuid companyId FK "nullable for platform-level super-admin actions"
        uuid actorUserId FK "nullable - see note below"
        string action "e.g. LEAVE_APPROVED, BALANCE_ADJUSTED"
        string entityType
        uuid entityId
        jsonb metadata
        timestamptz createdAt
    }
```

## Key constraints and indexes

- `companies.code` — `UNIQUE`. Entered at login alongside email/employee ID and
  password; it's how the API resolves which tenant to authenticate against
  before anything else runs.
- `company_settings.companyId` — PK and FK, one row per company (1:1), created
  automatically when a company is created, holding the configurable defaults
  from CLAUDE.md §Business defaults.
- `departments`: `UNIQUE (companyId, name)`; index on `companyId`.
- `designations`: `UNIQUE (companyId, name)`; index on `companyId`.
- `employees`: `UNIQUE (companyId, employeeCode)`; index on `companyId`; index
  on `(companyId, managerId)` to make "give me my team" (Manager view) fast;
  `managerId` is nullable and self-referential, enforced to point to an
  employee in the *same* `companyId` (checked in application code, since Postgres
  can't express a same-row-group FK constraint directly).
- `users`: `email` is nullable (login can be by employee code instead) with a
  **partial unique index** `UNIQUE (companyId, email) WHERE email IS NOT NULL`
  — not globally unique, since two different companies may have an admin with
  the same email; a second partial unique index `UNIQUE (email) WHERE
  companyId IS NULL` covers `SUPER_ADMIN` accounts, which have no company;
  index on `companyId`; `UNIQUE (employeeId)` where not null, since an
  employee has at most one login; `CHECK (employeeId IS NOT NULL OR email IS
  NOT NULL)` so an account with no employee profile can't end up with no way
  to log in.
- `refresh_tokens`: index on `userId`; index on `tokenHash` (lookup on refresh);
  `expiresAt` indexed for the cleanup job that purges expired rows.
- `leave_types`: `UNIQUE (companyId, code)`.
- `company_holidays`: `UNIQUE (companyId, date)`.
- `leave_balances`: `UNIQUE (companyId, employeeId, leaveTypeId, year)` — this
  is the row a leave-request transaction locks (`SELECT ... FOR UPDATE`) and
  updates, so the uniqueness also protects against double-allocation.
  **Available balance is derived, not stored**: `available = allocatedDays +
  carriedOverDays - usedDays - pendingDays`. Submitting a request checks
  `available >= totalDays` and increments `pendingDays` inside the same
  transaction as creating the `leave_requests` row + row lock; a decision
  later moves days between `pendingDays`/`usedDays` (see `leave_requests`
  below) — see `docs/architecture.md` §3 for the full flow.
- `leave_requests`: index on `(companyId, employeeId)`; index on
  `(companyId, status)` for the manager/HR "pending approvals" queries; index
  on `proofDueAt` (nullable) for the sick-leave-proof reminder/escalation job;
  `CHECK (endDate >= startDate)`; `CHECK (EXTRACT(YEAR FROM startDate) =
  EXTRACT(YEAR FROM endDate))` — a request can't cross a calendar-year
  boundary.
- `leave_approvals`: `UNIQUE (leaveRequestId, step)` — each step is decided at
  most once; index on `leaveRequestId`; index on `approverUserId`.
- `leave_request_documents`: index on `leaveRequestId`; `objectKey` is never
  derived from user input (server-generated UUID path), so it can't be used to
  probe other tenants' files.
- `notifications`: index on `(companyId, userId, readAt)` for the "unread
  count" query.
- `audit_logs`: index on `(companyId, createdAt)` and on `entityType, entityId`
  for "show me the history of this record."

## Notes on design choices

- **One user per employee, not one employee = one user.** `users` is a
  separate table from `employees` because `SUPER_ADMIN` and some
  `COMPANY_ADMIN` accounts are not necessarily tied to an employee profile.
  `users.employeeId` is nullable and unique when present.
- **Role lives on `users`, not `employees`.** An employee profile (department,
  designation, manager) is HR data; a role is an access-control concept. Phase
  1 keeps it to one role per user (no multi-role) since nothing in the
  proposal requires more.
- **`leave_balances` is keyed by year** rather than being a single running
  total, so year-end carry-forward and reporting ("balance as of last year")
  are simple queries instead of derived from the full request history.
- **`company_holidays`** exists now (even though attendance is Phase 2)
  because leave-day calculation (CLAUDE.md: "validate working days and
  holidays") needs it in Phase 1.
- **`leave_approvals` is a separate table, not columns on `leave_requests`.**
  A request can go through up to two decision steps (`MANAGER`, `HR`) under
  the `MANAGER_THEN_HR` workflow. Modeling each step as its own row means a
  request's full decision history (who, when, what note, at which step) is
  queryable without overloading `leave_requests` with "first decision" /
  "second decision" column pairs, and it's where idempotency is enforced
  (`UNIQUE (leaveRequestId, step)` — a step can't be decided twice).
  `leave_requests.status` is the fast-to-query current state
  (`PENDING_MANAGER | PENDING_HR | APPROVED | REJECTED | CANCELLED |
  REVOKED`); `leave_approvals` is the append-only log behind it.
- **Approver routing**: a request starts at `PENDING_MANAGER` if the employee
  has a `managerId`; if they don't (e.g. the employee *is* the top of a
  reporting line, or no manager has been assigned yet), it starts at
  `PENDING_HR` directly — there's no step to skip. HR can act on any request
  regardless of step (fallback/override for when a manager is unavailable),
  and that action is still recorded as a `leave_approvals` row (`step:
  MANAGER`, `approverUserId` = the HR user) so it's auditable. **An HR
  fallback decision at the `MANAGER` step is final** — under
  `MANAGER_THEN_HR` it does not advance to `PENDING_HR` afterwards, since
  that would route the request back to the same HR team that already acted
  on it. Nobody can decide their own request — enforced in the service layer
  by comparing `approverUserId`'s linked `employeeId` to
  `leave_requests.employeeId`, not by a DB constraint (self-review is a
  business rule, not a structural impossibility).
- **`leave_requests.revokedBy`/`revokedAt`/`revokeNote`** are separate from
  `leave_approvals` because revoking an already-`APPROVED` request (e.g. the
  employee's plans changed) is not a decision step in the approval workflow —
  it's a distinct, rarer action (HR/Company Admin only) that moves status to
  `REVOKED` and decrements `usedDays` by `totalDays`. It does **not** touch
  `pendingDays` — those days already left `pendingDays` when the request was
  approved, so revoke only has to undo the `usedDays` side.
- **Sick leave proof tracking lives on `leave_requests`** (`proofStatus`,
  `proofDueAt`) as a fast-to-query aggregate, separate from the individual
  rows in `leave_request_documents` — a request can accumulate multiple
  document attempts (e.g. one rejected, a replacement accepted), and
  `proofStatus` reflects the current overall state HR/the employee care
  about, while `leave_request_documents` keeps the full history. `proofDueAt`
  is set at submit time to `startDate + company_settings.sickLeaveProofDeadlineDays`
  only when the leave type `requiresProof`.
- **Leave balance initialization, no proration.** Balance rows are created
  (not computed on the fly) at two points: when a new employee is created, a
  current-year `leave_balances` row is inserted for every existing leave type
  in that company; when a new leave type is created, a current-year row is
  inserted for every existing employee. Both use the leave type's
  `defaultAnnualDays` as `allocatedDays`, with `usedDays`/`pendingDays`/
  `carriedOverDays` all `0`. Phase 1 does **not** prorate for an employee who
  joins mid-year — if a company wants a different starting allocation, HR
  adjusts the balance manually (same audited adjustment path used for
  corrections). As a safety net, the leave-request submission path also
  creates the row on first use (same defaults) if it's ever missing for the
  requested year, so a submission never fails just because the seeding step
  didn't run — see `docs/architecture.md` §3.
- **A leave request must fall within a single calendar year** — `CHECK
  (EXTRACT(YEAR FROM startDate) = EXTRACT(YEAR FROM endDate))` on
  `leave_requests`. This keeps "which `leave_balances` row (year)" unambiguous;
  a request spanning a year boundary (e.g. Dec 29 → Jan 3) is rejected at
  submission and the employee files it as two separate requests instead.
- **`users` requires at least one login identifier**: `CHECK (employeeId IS
  NOT NULL OR email IS NOT NULL)`. A user with no linked employee profile
  (e.g. a `COMPANY_ADMIN` or `SUPER_ADMIN` account) has no employee code to
  log in with, so it must have an email; this is enforced as a real database
  constraint, not just application validation, since it's cheap to express
  and catches the case structurally.
- **`audit_logs.actorUserId` is nullable** (added during Step 1.2, auth): a
  failed login attempt against a company code or identifier that doesn't
  match any account has no user row to attach as the actor, but is exactly
  the kind of event worth auditing (repeated failed logins against an
  unknown identifier is a brute-force signal). Such entries are written with
  `actorUserId: null` and the attempted identifier/IP captured in `metadata`.
  A successful login, or a failure against a *resolved* user (wrong
  password, deactivated account), still sets `actorUserId` to that user.
- Every table above except `companies` carries `companyId` directly — even
  `leave_balances` and `leave_request_documents`, which are technically
  reachable via a join through `employees`/`leave_requests` — so the
  tenant-scoped Prisma extension (see `docs/architecture.md` §5) can filter
  every table the same way without needing a join to find the tenant.
