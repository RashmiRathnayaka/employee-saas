# Database Schema — Phase 2 (Attendance & Site Management)

**Status: design approved; open questions resolved 2026-11-03 (see
`plan.md`).** Nothing here is migrated yet.

This adds to `docs/database-schema.md` (Phase 1). The same conventions apply:
- `id` is a UUID.
- Timestamps are `TIMESTAMPTZ` in UTC.
- Calendar dates are `date` (`YYYY-MM-DD`, in the company timezone; see
  `docs/architecture.md` §8).
- Every company-owned table has `companyId UUID NOT NULL REFERENCES
  companies(id)`, an index that starts with `companyId`, and is added to
  `TENANT_MODELS` in `apps/api/src/lib/tenantPrisma.ts`.

**Freeze check.** No column is added to, removed from or changed on `users`,
`companies` or `refresh_tokens`. New tables only *reference* `users.id` and
`companies.id`. See "Prisma back-relations" at the end for the one subtlety.

**Which person-id to use:**
- **`employees.id`** for anything about a person's work: attendance, site
  visits, schedules, task assignees.
- **`users.id`** only where it is truly about a login: push device tokens,
  notification settings, and "who did this" actor columns
  (`createdByUserId`, `correctedByUserId`). Actor columns use `users.id`
  because a COMPANY_ADMIN may have no employee profile, and this matches
  Phase 1 (`leave_approvals.approverUserId`, `audit_logs.actorUserId`).

---

## ER diagram (new tables + the existing tables they touch)

Existing tables are shown with only the columns that matter here.

```mermaid
erDiagram
    COMPANIES ||--o| COMPANY_SETTINGS : has
    COMPANIES ||--o{ SITES : has
    COMPANIES ||--o{ JOB_RUNS : "has (per-company job claims)"
    EMPLOYEES ||--o| EMPLOYEE_SCHEDULES : "optional override"
    EMPLOYEES ||--o{ ATTENDANCE_RECORDS : "one per work date"
    EMPLOYEES ||--o{ SITE_VISITS : makes
    EMPLOYEES ||--o{ TASKS : "assigned (assigneeEmployeeId)"
    SITES ||--o{ ATTENDANCE_RECORDS : "office checked in at (optional)"
    SITES ||--o{ SITE_VISITS : "visited at"
    SITES ||--o{ TASKS : "optional location"
    ATTENDANCE_RECORDS ||--o{ SITE_VISITS : "visits that day (optional)"
    ATTENDANCE_RECORDS ||--o{ ATTENDANCE_CORRECTIONS : "corrected by HR"
    SITE_VISITS ||--o{ ATTENDANCE_CORRECTIONS : "corrected by HR"
    USERS ||--o{ ATTENDANCE_CORRECTIONS : "corrects (correctedByUserId)"
    USERS ||--o{ TASKS : "creates (createdByUserId)"
    USERS ||--o{ SITES : "creates (createdByUserId)"
    USERS ||--o{ PUSH_DEVICES : "logged in on"
    USERS ||--o| USER_NOTIFICATION_SETTINGS : has
    USERS ||--o{ NOTIFICATIONS : receives
    NOTIFICATIONS ||--o{ PUSH_MESSAGES : "sent as push"
    PUSH_DEVICES ||--o{ PUSH_MESSAGES : "delivered to"

    COMPANY_SETTINGS {
        uuid companyId PK_FK
        jsonb enabledModules "existing; new keys attendance, sites, tasks"
        jsonb workingDays "existing"
        boolean gpsCheckinEnabledDefault "existing; default for new sites"
        int gpsRadiusMeters "existing; default for new sites"
        string workStartTime "NEW HH:mm, default 09:00"
        string workEndTime "NEW HH:mm, default 17:00"
        string halfDayEndTime "NEW HH:mm, default 13:00"
        int lateGraceMinutes "NEW default 10"
        int autoCheckoutAfterMinutes "NEW default 240"
        boolean checkinReminderEnabled "NEW default true"
        int checkinReminderOffsetMinutes "NEW default 0"
        boolean proofRemindersEnabled "NEW default true"
        string dailyReminderTime "NEW HH:mm, default 09:00"
        int gpsMaxAccuracyMeters "NEW default 100"
        int gpsRetentionDays "NEW default 90"
    }

    SITES {
        uuid id PK
        uuid companyId FK
        string name "unique per company, case-insensitive"
        string type "OFFICE | EXTERNAL"
        string address "nullable"
        decimal latitude "9,6 nullable"
        decimal longitude "9,6 nullable"
        int radiusMeters
        boolean gpsRequired
        boolean isActive "default true"
        uuid createdByUserId FK "users.id"
        timestamptz createdAt
        timestamptz updatedAt
    }

    EMPLOYEE_SCHEDULES {
        uuid id PK
        uuid companyId FK
        uuid employeeId FK "unique per company"
        string startTime "HH:mm"
        string endTime "HH:mm; earlier than start = crosses midnight"
        jsonb workingDays "nullable = use company's"
        int lateGraceMinutes "nullable = use company's"
        timestamptz updatedAt
    }

    ATTENDANCE_RECORDS {
        uuid id PK
        uuid companyId FK
        uuid employeeId FK
        date workDate "company-local date the shift starts on"
        string status "PRESENT|LATE|ON_LEAVE|HOLIDAY|ABSENT|INCOMPLETE"
        timestamptz scheduledStartAt "snapshot, nullable on non-working days"
        timestamptz scheduledEndAt "snapshot"
        timestamptz checkInAt "nullable (ABSENT/ON_LEAVE/HOLIDAY rows)"
        timestamptz checkOutAt "nullable"
        int workedMinutes "nullable until closed"
        int lateMinutes "default 0"
        int earlyLeaveMinutes "default 0"
        uuid checkInSiteId FK "nullable, OFFICE site"
        decimal checkInLat "nullable, purged after retention"
        decimal checkInLng
        int checkInAccuracyM
        int checkInDistanceM
        boolean checkInWithinRadius
        boolean checkInMocked
        decimal checkOutLat
        decimal checkOutLng
        int checkOutAccuracyM
        int checkOutDistanceM
        boolean checkOutWithinRadius
        boolean checkOutMocked
        string_array flags "see list below"
        string source "MOBILE | SITE_VISIT | HR | SYSTEM"
        timestamptz autoClosedAt "nullable"
        boolean isCorrected "default false"
        uuid checkInClientRequestId "nullable, retry de-dup"
        timestamptz createdAt
        timestamptz updatedAt
    }

    SITE_VISITS {
        uuid id PK
        uuid companyId FK
        uuid employeeId FK
        uuid siteId FK
        uuid attendanceRecordId FK "nullable"
        date workDate
        string status "OPEN | CLOSED | AUTO_CLOSED"
        timestamptz checkInAt
        timestamptz checkOutAt "nullable"
        int durationMinutes "nullable until closed"
        decimal checkInLat "same GPS column set as attendance"
        decimal checkOutLat "etc."
        string_array flags
        text note "nullable, max 500"
        uuid clientRequestId "unique per company, retry de-dup"
        boolean isCorrected
        timestamptz createdAt
        timestamptz updatedAt
    }

    ATTENDANCE_CORRECTIONS {
        uuid id PK
        uuid companyId FK
        uuid attendanceRecordId FK "nullable"
        uuid siteVisitId FK "nullable"
        uuid correctedByUserId FK "users.id"
        text reason "required"
        jsonb before "null when HR created the record"
        jsonb after
        timestamptz createdAt
    }

    TASKS {
        uuid id PK
        uuid companyId FK
        string title "max 200"
        text description "nullable, max 5000"
        uuid assigneeEmployeeId FK "employees.id"
        uuid siteId FK "nullable"
        date dueDate "nullable"
        string status "TODO | IN_PROGRESS | DONE"
        timestamptz completedAt "nullable"
        uuid createdByUserId FK "users.id"
        timestamptz createdAt
        timestamptz updatedAt
    }

    PUSH_DEVICES {
        uuid id PK
        uuid companyId FK
        uuid userId FK "users.id: a device belongs to a login"
        string expoPushToken "unique"
        string platform "ANDROID | IOS"
        string deviceName "nullable"
        timestamptz lastSeenAt
        timestamptz disabledAt "nullable"
        string disabledReason "nullable, e.g. DeviceNotRegistered"
        timestamptz createdAt
    }

    USER_NOTIFICATION_SETTINGS {
        uuid userId PK_FK
        uuid companyId FK
        boolean pushEnabled "default true"
        string_array pushDisabledCategories "LEAVE|ATTENDANCE|SITES|TASKS|REMINDERS"
        timestamptz updatedAt
    }

    PUSH_MESSAGES {
        uuid id PK
        uuid companyId FK
        uuid notificationId FK
        uuid pushDeviceId FK
        string status "PENDING|SENT|DELIVERED|FAILED|SKIPPED"
        int attempts "default 0"
        timestamptz nextAttemptAt
        string expoTicketId "nullable"
        string errorCode "nullable"
        timestamptz sentAt
        timestamptz receiptCheckedAt
        timestamptz createdAt
    }

    JOB_RUNS {
        uuid id PK
        uuid companyId FK "nullable for platform-wide jobs"
        string jobName
        string runKey "e.g. 2026-11-03"
        string status "RUNNING | DONE | FAILED"
        int attempts
        timestamptz startedAt
        timestamptz finishedAt
        text lastError "nullable, no personal data"
    }

    NOTIFICATIONS {
        uuid id PK
        uuid companyId FK
        uuid userId FK
        string type
        string dedupeKey "NEW nullable"
    }
```

---

## Changes to existing (non-frozen) tables

### `company_settings` (new columns, all with defaults, so existing rows stay valid)

| Column | Type | Default | Purpose |
|---|---|---|---|
| `workStartTime` | `text` `CHECK ~ '^([01]\d\|2[0-3]):[0-5]\d$'` | `'09:00'` | Company default schedule start (local wall time) |
| `workEndTime` | same | `'17:00'` | Default end. Earlier than start means the shift crosses midnight |
| `halfDayEndTime` | same | `'13:00'` | End time on days marked `HALF` in `workingDays` (e.g. Saturday) |
| `lateGraceMinutes` | `int CHECK 0..240` | `10` | Check-in later than start + grace = `LATE` |
| `autoCheckoutAfterMinutes` | `int CHECK 30..720` | `240` | The day is closed this long after the scheduled end (auto check-out → `INCOMPLETE`, absent marking) |
| `checkinReminderEnabled` | `boolean` | `true` | |
| `checkinReminderOffsetMinutes` | `int CHECK 0..120` | `0` | Minutes after scheduled start to send the "you haven't checked in" reminder |
| `proofRemindersEnabled` | `boolean` | `true` | Sick-leave proof reminders on/off |
| `dailyReminderTime` | `HH:mm` text | `'09:00'` | Local time for once-a-day reminders (proof due/overdue) |
| `gpsMaxAccuracyMeters` | `int CHECK 10..1000` | `100` | Above this, a GPS fix counts as "poor accuracy" (rules in architecture §3) |
| `gpsRetentionDays` | `int CHECK 30..365` | `90` | Raw coordinates are erased after this many days |

The existing `gpsCheckinEnabledDefault` and `gpsRadiusMeters` keep their
meaning as **the defaults for a new site** (`sites.gpsRequired`,
`sites.radiusMeters`). They are no longer read at check-in time; the site's
own values are.

**`enabledModules` keys.** The JSON gains three keys: `attendance`, `sites`,
`tasks`.
- A missing key means **off** (deny by default; decided, Q1). New
  companies get Phase 2 modules off.
- The seed sets all three to `true` for ACME and leaves BETA without them
  (off). The migration itself **doesn't** change any existing company's
  `enabledModules` value.
- Leave and notifications are Phase 1 core and are not gated.

Times are stored as `HH:mm` text, not Postgres `time`. Prisma maps `time` to
a JS `Date` on 1970-01-01, which is confusing and easy to shift by a
timezone by accident. A plain `"09:00"` string has no timezone, which is
exactly what a "wall clock" time is. Converting it to a UTC instant for a
given date happens in one shared helper (`zonedDateTimeToUtc`, see
`architecture-phase2.md` §1).

### `notifications`

| Column | Type | Purpose |
|---|---|---|
| `dedupeKey` | `text NULL` | Lets a job write "at most one" notification, e.g. `CHECKIN_REMINDER:<employeeId>:2026-11-03` |

- New partial unique index `UNIQUE (companyId, dedupeKey) WHERE dedupeKey
  IS NOT NULL`. A job inserts with `ON CONFLICT DO NOTHING`, so running it
  twice (or on two servers at once) sends one reminder.
- `relatedEntityType` gains `AttendanceRecord`, `SiteVisit`, `Task` (it is
  free text in the DB; the allowed list lives in `packages/shared`).

---

## New tables

### `sites`
- `UNIQUE (companyId, lower(name))`, a functional index like departments.
- Index `(companyId, isActive, type)`.
- `CHECK (radiusMeters BETWEEN 25 AND 5000)`.
- `CHECK (NOT gpsRequired OR (latitude IS NOT NULL AND longitude IS NOT NULL))`:
  a GPS-required site must have coordinates.
- `CHECK (latitude BETWEEN -90 AND 90)`, `CHECK (longitude BETWEEN -180 AND 180)`.
- A site is never hard-deleted once any visit, attendance record or task
  references it (FK `ON DELETE RESTRICT`). It is deactivated instead.
- `type = OFFICE` is what office attendance checks GPS against. A company
  may have several offices (branches).

### `employee_schedules`
- `UNIQUE (companyId, employeeId)`: one override per employee, no history.
  Changes are audited (`SCHEDULE_UPDATED`, with before/after), and every
  attendance record keeps a snapshot of the schedule it was judged against
  (`scheduledStartAt` / `scheduledEndAt`). So changing a schedule never
  rewrites past lateness.
- Same `HH:mm` CHECKs as company_settings.
- App rule: the shift length is 1–16 hours, including across midnight.
- Deleting the row means "use the company default again".

### `attendance_records`
One row per employee per work date. This is the core decision; see
architecture §1 for why there's a single check-in/check-out pair per day.
- `UNIQUE (companyId, employeeId, workDate)`. This is what makes
  double check-in impossible, even with two simultaneous requests: the
  second `INSERT` fails and the API returns `409 ALREADY_CHECKED_IN`.
- Indexes:
  - `(companyId, workDate, status)` for the daily report and dashboard
  - `(companyId, employeeId, workDate)` (covered by the unique)
  - partial index `(companyId, scheduledEndAt) WHERE checkOutAt IS NULL AND
    checkInAt IS NOT NULL`, for the auto-close job
  - `(companyId, checkInAt) WHERE checkInLat IS NOT NULL`, for the GPS purge
- Constraints:
  - `CHECK (checkOutAt IS NULL OR checkOutAt > checkInAt)`
  - `CHECK (checkOutAt IS NULL OR checkInAt IS NOT NULL)`: you can't have a
    check-out without a check-in
  - `CHECK (status NOT IN ('PRESENT','LATE','INCOMPLETE') OR checkInAt IS
    NOT NULL)`
  - `CHECK (workedMinutes IS NULL OR workedMinutes >= 0)`
- `flags` is a Postgres `text[]` holding values from a shared enum:
  - `LOW_ACCURACY`, `OUTSIDE_RADIUS_AT_CHECKOUT`, `MOCK_LOCATION_AT_CHECKOUT`
  - `NO_OFFICE_SITE`
  - `NON_WORKING_DAY` (checked in on a holiday or weekly off day)
  - `ON_APPROVED_LEAVE` (checked in on a day with approved leave)
  - `HALF_DAY_LEAVE`
  - `AUTO_CLOSED`
  - `LONG_SHIFT` (more than 16 h)
- `source`:
  - `MOBILE`: checked in in the app
  - `SITE_VISIT`: the day was started by a site check-in
  - `HR`: created by HR
  - `SYSTEM`: an ABSENT/ON_LEAVE/HOLIDAY row written by the day-close job
- GPS columns: `latitude`/`longitude` are `DECIMAL(9,6)` (about 0.1 m).
  Accuracy and distance are whole metres.
  - After `gpsRetentionDays`, a job sets `*Lat`/`*Lng` to NULL.
  - `*AccuracyM`, `*DistanceM`, `*WithinRadius`, `*Mocked` and `flags` are
    kept. They're what HR needs, and they don't reveal where someone was.
- `checkInClientRequestId`: if the phone retries a check-in whose response
  got lost, the server finds the existing row by this id and returns it
  with 200 instead of a 409.

### `site_visits`
- At most one open visit per employee: partial unique index `UNIQUE
  (companyId, employeeId) WHERE status = 'OPEN'`. A second check-in while
  one is open returns `409 VISIT_ALREADY_OPEN` with the open visit.
- `UNIQUE (companyId, clientRequestId)` for retry de-duplication.
- Indexes:
  - `(companyId, siteId, checkInAt)` for site history
  - `(companyId, employeeId, checkInAt)` for "my visits" and the team view
  - `(companyId, workDate)` for reports
- Same check-out CHECKs and GPS column set as `attendance_records`.
- `durationMinutes = floor((checkOutAt - checkInAt) / 60s)`. It is computed
  by the server on check-out or correction, never sent by the client.
  `AUTO_CLOSED` visits have `checkOutAt` NULL and `durationMinutes` NULL
  until HR corrects them.

### `attendance_corrections`
An append-only history of HR changes. Rows are never updated or deleted.
- `CHECK ((attendanceRecordId IS NULL) <> (siteVisitId IS NULL))`: exactly
  one of the two is set.
- `CHECK (length(trim(reason)) >= 5)`.
- Index `(companyId, attendanceRecordId)` and `(companyId, siteVisitId)`.
- `before` / `after` hold only the corrected fields (times, site, status),
  **never coordinates**.
- Every correction also writes an `audit_logs` row in the same transaction
  (`ATTENDANCE_CORRECTED` / `ATTENDANCE_CREATED_BY_HR` /
  `SITE_VISIT_CORRECTED`). This table exists in addition to the audit log
  so the record's detail screen can show "corrected by HR on …: reason"
  without parsing the audit log.

### `tasks`
- Index `(companyId, assigneeEmployeeId, status)` for "my tasks";
  `(companyId, dueDate)`; `(companyId, siteId)`.
- `CHECK (status <> 'DONE' OR completedAt IS NOT NULL)`.
- `assigneeEmployeeId` and `siteId` must belong to the same company. This
  is checked in the service, as with `employees.managerId`.

### `push_devices`
- `UNIQUE (expoPushToken)`. It's **global**, not per company, on purpose:
  one phone install has one token. If someone logs out and a colleague
  logs in on the same phone (even in another company), the register call
  moves the row to the new `userId`/`companyId`. Notifications for the
  previous user then stop reaching that phone.
- Index `(companyId, userId) WHERE disabledAt IS NULL`.
- This table is tenant-scoped like every other (`companyId` is filtered).
  The single exception is the upsert-by-token on register. It runs on the
  platform client, inside one reviewed function, because it must find a
  token row that may belong to another company in order to move it. It
  never returns that row's data.

### `user_notification_settings`
- PK `userId`. The row is created lazily; a missing row means "push on,
  all categories".
- This is a separate table rather than a column on `users`, because
  `users` is frozen.

### `push_messages` (outbox)
- One row per (notification × active device), written **in the same
  transaction** as the notification, by `createNotification`.
- `UNIQUE (notificationId, pushDeviceId)`.
- Partial index `(nextAttemptAt) WHERE status = 'PENDING'` (sender) and
  `(sentAt) WHERE status = 'SENT'` (receipt checker).
- Rows older than 30 days are purged.

### `job_runs`
- `UNIQUE (jobName, runKey, companyId)`, with `companyId` treated as a value
  even when null. That's Postgres 15+ `NULLS NOT DISTINCT`; we run 16.
  - This one row is how two API instances agree who runs a job: whoever's
    `INSERT … ON CONFLICT DO NOTHING` succeeds owns the run (architecture
    §5).
- Index `(status, startedAt)` to find stuck runs.
- Purged after 30 days.
- **Not** in `TENANT_MODELS`. Like `refresh_tokens`, it's infrastructure:
  it holds no tenant business data, only a `companyId` reference. Only the
  job runner touches it, through the platform client. The job's actual
  work then runs through `getTenantPrisma(companyId)` like any request.

---

## Cross-module effects on existing data (no schema change)

- **Leave approved** for dates that already have an `ABSENT` row (e.g. sick
  leave for yesterday, approved today): in the same transaction, those rows
  become `ON_LEAVE`.
- **Leave revoked or cancelled** after the day-close job ran: `ON_LEAVE`
  rows with no check-in go back to `ABSENT`. Rows with a check-in only
  lose the `ON_APPROVED_LEAVE` flag.
- **Holiday added for a past date**: `ABSENT` rows on that date become
  `HOLIDAY`. A holiday deleted for a past date flips them back.
- **Employee deactivated**: open site visits and attendance are closed
  (`AUTO_CLOSED`, with reason in `flags`), and open tasks stay as they are,
  for HR to reassign.

---

## Migrations: Prisma back-relations and the freeze

**Approved by the developer (Q13, 2026-11-03).**

Prisma needs a field on **both** sides of a relation. Adding a `Site`
model with `company Company @relation(...)` therefore also needs a
`sites Site[]` line inside `model Company`, and `PushDevice` needs
`pushDevices PushDevice[]` inside `model User`.

These "back-relation" lines are Prisma metadata only. They generate **no
SQL** on the `companies` or `users` tables; the foreign key lives on the
new table. So they're allowed under the freeze, while the tables
themselves stay frozen.

**Rule for every Phase 2 migration:**
1. Write the migration SQL with `prisma migrate diff` between the old and
   new `schema.prisma`, as in step 1.7. Never use `migrate dev` or a reset,
   because hand-written Phase 1 SQL (functional and partial indexes,
   CHECKs) isn't in the Prisma schema and must not be dropped.
2. **Check the generated SQL contains no `ALTER TABLE "companies"`, `ALTER
   TABLE "users"` or `ALTER TABLE "refresh_tokens"`.** Any such line means
   the freeze is being broken: stop and ask.
3. Add the hand-written parts (functional/partial unique indexes, CHECKs,
   `NULLS NOT DISTINCT`) to the migration SQL by hand, and record them in
   this document.
4. Apply with `prisma migrate deploy` to dev and test, and check the new
   indexes in `pg_indexes`.
5. The step report lists the back-relation lines added to `Company`/`User`
   in that step.
