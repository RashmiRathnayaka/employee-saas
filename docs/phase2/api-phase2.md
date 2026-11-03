# API — Phase 2 endpoint list

**Status: design, awaiting approval (step 2.0).**

The conventions are the same as `docs/api-phase1.md`:
- Base path `/api/v1`.
- Bodies are Zod schemas in `packages/shared`.
- Error shape is `{ "error": { "code", "message", "details"? } }`.
- Lists take `page` and `pageSize` (max 100) and return `{ data, page,
  pageSize, total }`.

"Role" is the minimum role allowed to call an endpoint. The scoping rules
(e.g. a manager only sees their own team) are in `permissions-phase2.md`.

Every endpoint is tenant-scoped from the token. A resource from another
company, or one outside the caller's scope (another employee's record, a
non-report's record for a manager), returns **404**, never 403.

**Module gate:** every endpoint below that is marked with a module returns
`403 MODULE_DISABLED` when that module is off in
`company_settings.enabledModules`. SUPER_ADMIN gets `403` on all of them,
since it has no company.

"Any employee" means any company user who has an employee profile. A
COMPANY_ADMIN account without an employee profile gets `403
NO_EMPLOYEE_PROFILE` on the "self" endpoints.

## Company settings (extended, not new)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/company/settings` | any | Now also returns the work schedule defaults (`workStartTime`, `workEndTime`, `halfDayEndTime`, `lateGraceMinutes`, `autoCheckoutAfterMinutes`), reminder settings and GPS settings (`gpsMaxAccuracyMeters`, `gpsRetentionDays`). `enabledModules` now has `attendance`, `sites` and `tasks`. |
| PATCH | `/company/settings` | COMPANY_ADMIN | Accepts the new fields (validated `HH:mm`, ranges as in the schema doc). Audited as `COMPANY_SETTINGS_UPDATED` with before/after, as in Phase 1. |

## Schedules (module `attendance`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/schedule/me` | any employee | My effective schedule: start/end, grace and source (`COMPANY` / `OVERRIDE`), plus the next 14 days with each day's type (`WORKING` / `HALF` / `OFF` / `HOLIDAY` / `ON_LEAVE`) and scheduled times |
| GET | `/employees/:id/schedule` | COMPANY_ADMIN, HR, MANAGER (own team) | An employee's effective schedule + override (if any) |
| PUT | `/employees/:id/schedule` | COMPANY_ADMIN, HR | Set or replace the override `{ startTime, endTime, workingDays?, lateGraceMinutes? }`. Audited as `SCHEDULE_UPDATED`. |
| DELETE | `/employees/:id/schedule` | COMPANY_ADMIN, HR | Remove the override and go back to the company default. Audited. |

## Office attendance (module `attendance`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/attendance/me/today` | any employee | Home card state: the current work date, the effective schedule, today's record (or null), the open site visit (or null), `gpsRequired` + office site (name, radius) for the nearest office, and `nextAction` (`CHECK_IN` / `CHECK_OUT` / `DONE` / `DAY_CLOSED`) |
| POST | `/attendance/check-in` | any employee | Body `{ clientRequestId: uuid, location?: { latitude, longitude, accuracy, mocked, capturedAt }, clientTime? }`. The server picks the work date, runs the GPS rules (architecture §3.2) and computes the status. **201** with the record; **200** with the existing record if it's a retry with the same `clientRequestId`. **409** `ALREADY_CHECKED_IN` / `ALREADY_CHECKED_OUT`; **422** `LOCATION_REQUIRED` / `OUTSIDE_SITE_RADIUS` / `MOCK_LOCATION_DETECTED`. |
| POST | `/attendance/check-out` | any employee | Body `{ location?, clientTime? }`. Closes today's record (and any open site visit, in the same transaction) and computes `workedMinutes` and `earlyLeaveMinutes`. **409** `NOT_CHECKED_IN` / `ALREADY_CHECKED_OUT` / `DAY_ALREADY_CLOSED`. GPS problems only add flags here and never reject (architecture §3.2). |
| GET | `/attendance/me` | any employee | My records, with `from`/`to` (dates, max 93 days) and pagination. Includes my own coordinates. |
| GET | `/attendance/team` | MANAGER | Direct reports' records. Filters: `date` or `from`/`to`, `employeeId` (narrowed to the team), `status`. No raw coordinates. |
| GET | `/attendance` | COMPANY_ADMIN, HR | All records. Filters: `date` or `from`/`to`, `employeeId`, `departmentId`, `status`, `flag`. No raw coordinates in the list. |
| GET | `/attendance/:id` | owner, their MANAGER, COMPANY_ADMIN, HR | One record with its site visits and correction history. Coordinates are included for the owner and HR/Company Admin only. |
| POST | `/attendance` | COMPANY_ADMIN, HR | Create a record for a day that has none: `{ employeeId, workDate, checkInAt, checkOutAt?, siteId?, reason }`. `409` if a row exists (correct it instead). **400** `CANNOT_CORRECT_OWN_ATTENDANCE` if it's the caller's own. Audited as `ATTENDANCE_CREATED_BY_HR`. |
| PATCH | `/attendance/:id/correct` | COMPANY_ADMIN, HR | `{ checkInAt?, checkOutAt?, siteId?, reason }` (reason at least 5 chars). Recomputes the status, writes `attendance_corrections` + audit, and notifies the employee. A row that is `ABSENT` / `ON_LEAVE` / `HOLIDAY` can be given times, which turns it into `PRESENT` / `LATE`. Self-correction is blocked as above. |

## Sites (module `sites`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/sites` | any | Employees and managers: active sites only, with `id, name, type, address, gpsRequired, radiusMeters, hasCoordinates`. Sites from my open tasks come first, marked `fromMyTasks`. HR and Company Admin: all sites including inactive, with coordinates. Filters `type`, `active`, `q`. |
| GET | `/sites/:id` | any (employees: active only) | One site |
| POST | `/sites` | COMPANY_ADMIN, HR | Create `{ name, type, address?, latitude?, longitude?, radiusMeters?, gpsRequired? }`. Missing radius/gpsRequired come from company defaults. Audited as `SITE_CREATED`. |
| PATCH | `/sites/:id` | COMPANY_ADMIN, HR | Edit. Audited as `SITE_UPDATED` (before/after). Changing coordinates or radius doesn't re-evaluate past visits. |
| PATCH | `/sites/:id/status` | COMPANY_ADMIN, HR | `{ isActive }`. Deactivating doesn't close open visits (they close normally). Audited. |
| DELETE | `/sites/:id` | COMPANY_ADMIN, HR | Only if nothing references it; otherwise `409 SITE_IN_USE` (deactivate instead). Audited. |

## Site visits (module `sites`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/site-visits/check-in` | any employee | `{ siteId, clientRequestId, location?, note? }`. Uses the GPS rules with the site's settings. Starts the attendance day if needed (architecture §1.6). Notifies the manager (`SITE_CHECKED_IN`). **201**, or **200** on a retry. **409** `VISIT_ALREADY_OPEN`; **404** for an inactive or unknown site; **422** for the GPS errors. |
| POST | `/site-visits/:id/check-out` | visit owner | `{ location?, note? }` → computes `durationMinutes`. **409** `VISIT_NOT_OPEN`. |
| GET | `/site-visits/me` | any employee | My visits (`from`/`to`, paginated) |
| GET | `/site-visits/me/open` | any employee | My open visit or `null` (also included in `/attendance/me/today`) |
| GET | `/site-visits/team` | MANAGER | Direct reports' visits. Filters `from`/`to`, `employeeId`, `siteId`, `openOnly`. No raw coordinates. |
| GET | `/site-visits` | COMPANY_ADMIN, HR | All visits, same filters |
| GET | `/site-visits/:id` | owner, their MANAGER, COMPANY_ADMIN, HR | One visit with corrections. Coordinates for the owner and HR/Admin only. |
| PATCH | `/site-visits/:id/correct` | COMPANY_ADMIN, HR | `{ checkInAt?, checkOutAt?, reason }`. Same rules as attendance correction. Audited as `SITE_VISIT_CORRECTED`. |

## Tasks (module `tasks`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/tasks/me` | any employee | Tasks assigned to me. Filter `status`; sorted by due date then created date. |
| GET | `/tasks/team` | MANAGER | Tasks assigned to my direct reports (filter `employeeId`, `status`, `overdue`) |
| GET | `/tasks` | COMPANY_ADMIN, HR | All tasks, same filters plus `siteId` |
| GET | `/tasks/:id` | assignee, assignee's MANAGER, creator, COMPANY_ADMIN, HR | One task |
| POST | `/tasks` | MANAGER (assignee must be a direct report), COMPANY_ADMIN, HR | `{ title, description?, assigneeEmployeeId, siteId?, dueDate? }`. Notifies the assignee (`TASK_ASSIGNED`). Assigning to yourself is allowed. |
| PATCH | `/tasks/:id` | creator (a manager, only while the assignee is still on their team), COMPANY_ADMIN, HR | Edit title, description, site, due date or assignee. Reassigning notifies the new assignee. |
| PATCH | `/tasks/:id/status` | assignee, assignee's MANAGER, COMPANY_ADMIN, HR | `{ status }`. Any → any between `TODO` / `IN_PROGRESS` / `DONE`. Setting `DONE` sets `completedAt`; leaving `DONE` clears it. When the assignee marks it DONE, the creator gets `TASK_COMPLETED`. |
| DELETE | `/tasks/:id` | creator (as above), COMPANY_ADMIN, HR | Hard delete. Tasks aren't sensitive, so it isn't audited (Q22). |

## Push devices & notification settings (no module gate)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/push-devices` | any company user | `{ expoPushToken, platform: "ANDROID" \| "IOS", deviceName? }`. Upsert by token; moves it to the caller if it belonged to someone else. **200** `{ device }`. Token format validated (`ExponentPushToken[...]`). |
| POST | `/push-devices/unregister` | any company user | `{ expoPushToken }` → disables it if it's the caller's. Always **204**, so it doesn't reveal whether the token exists. |
| GET | `/notification-settings/me` | any company user | `{ pushEnabled, pushDisabledCategories, categories: [...] }` (defaults if no row) |
| PATCH | `/notification-settings/me` | any company user | Update either field |

## Notifications (extended, not new)
- Same endpoints as Phase 1. `relatedEntityType` can now also be
  `AttendanceRecord`, `SiteVisit` or `Task`.
- The shared `getNotificationTarget()` maps each type to a screen.
- New event types:

| Event | `type` | Recipient(s) | Push category |
|---|---|---|---|
| Site check-in | `SITE_CHECKED_IN` | the employee's manager (if active login) | SITES |
| Day auto-closed (no check-out) | `ATTENDANCE_AUTO_CLOSED` | the employee | ATTENDANCE |
| HR corrected attendance / visit | `ATTENDANCE_CORRECTED` | the employee (with reason) | ATTENDANCE |
| Check-in reminder | `CHECKIN_REMINDER` | the employee | REMINDERS |
| Proof due tomorrow | `LEAVE_PROOF_DUE_SOON` | the employee | REMINDERS |
| Proof overdue | `LEAVE_PROOF_OVERDUE` | active HR (not the requester) | REMINDERS |
| Task assigned / reassigned to me | `TASK_ASSIGNED` | the assignee (not if they assigned it to themselves) | TASKS |
| Task completed by assignee | `TASK_COMPLETED` | the creator (if not the assignee) | TASKS |
| All Phase 1 leave events | unchanged | unchanged | LEAVE |

## Reports (module `attendance` for attendance reports, `sites` for site reports)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/reports/attendance/daily` | COMPANY_ADMIN, HR, MANAGER (team) | `?date=YYYY-MM-DD` (default today, company time), plus `departmentId`, `status`. One row per in-scope active employee (architecture §6), with totals per status. Paginated. |
| GET | `/reports/attendance/daily/export` | same | Same filters → `text/csv` attachment `attendance-YYYY-MM-DD.csv`. Audited as `REPORT_EXPORTED`. |
| GET | `/reports/attendance/monthly` | COMPANY_ADMIN, HR, MANAGER (team) | `?month=YYYY-MM`, `departmentId`. Per employee: `presentDays, lateDays, absentDays, onLeaveDays, holidayDays, incompleteDays, totalWorkedMinutes`. Paginated. |
| GET | `/reports/attendance/monthly/export` | same | CSV `attendance-summary-YYYY-MM.csv`. Audited. |
| GET | `/reports/site-visits` | COMPANY_ADMIN, HR, MANAGER (team) | `from`, `to` (max 93 days), `siteId`, `employeeId`. Paginated visit rows with duration and flags. |
| GET | `/reports/site-visits/export` | same | CSV. Audited. |

## Dashboard (extended)
- `GET /dashboard/summary` adds these fields **only when the module is
  on**:
  - `attendanceToday: { present, late, notCheckedIn, onLeave, absentYesterday }`
  - `onSiteNow` (number of open visits)
  - `openTasks` and `overdueTasks`
- Manager figures are team-only. The response stays backward-compatible:
  the new fields are optional.

## Health (extended)
- `GET /health` adds `worker: { lastTickAt, ok }`. `ok` is true when the
  last tick was under 2 minutes ago.
- No job data is exposed.

## Error codes added in Phase 2
| Code | Status | Meaning |
|---|---|---|
| `MODULE_DISABLED` | 403 | The module is off for this company |
| `NO_EMPLOYEE_PROFILE` | 403 | A self-service attendance/site endpoint was called by a user without an employee profile |
| `ALREADY_CHECKED_IN` / `ALREADY_CHECKED_OUT` | 409 | One check-in/out pair per work date |
| `NOT_CHECKED_IN` | 409 | Check-out with nothing to close |
| `DAY_ALREADY_CLOSED` | 409 | Auto-closed; ask HR |
| `VISIT_ALREADY_OPEN` / `VISIT_NOT_OPEN` | 409 | Site visit state |
| `SITE_IN_USE` | 409 | Delete blocked; deactivate instead |
| `LOCATION_REQUIRED` | 422 | GPS-required site, no location sent |
| `OUTSIDE_SITE_RADIUS` | 422 | `details: { distanceM, radiusM, siteName }` |
| `MOCK_LOCATION_DETECTED` | 422 | Android reported a mock location |
| `CANNOT_CORRECT_OWN_ATTENDANCE` | 400 | Self-correction blocked |
