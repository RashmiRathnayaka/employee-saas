# API — Phase 2 endpoint list

**Status: design approved; open questions resolved 2026-11-03 (see
`plan.md`).**

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
| GET | `/company/settings` | any | Now also returns the work schedule defaults (`workStartTime`, `workEndTime`, `halfDayEndTime`, `lateGraceMinutes`, `autoCheckoutAfterMinutes`), reminder settings and GPS settings (`gpsMaxAccuracyMeters`, `gpsRetentionDays`). `enabledModules` now has `attendance`, `sites` and `tasks`. Also `attendanceEnabledAt` (read-only; set when attendance is switched on). |
| PATCH | `/company/settings` | COMPANY_ADMIN | Accepts the new fields (validated `HH:mm`, ranges as in the schema doc). `enabledModules` accepts only `attendance`, `sites` and `tasks`, and is merged into the stored value. `gpsRadiusMeters` must be 25–5000. The shift from `workStartTime` to `workEndTime` must be 1–16 hours, including across midnight; if a PATCH sends only one of them, it's checked against the stored other one (**400** `VALIDATION_ERROR` on the field). Audited as `COMPANY_SETTINGS_UPDATED`, with the before and after values of the fields that changed. |

## Schedules (module `attendance`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/schedule/me` | any employee | My effective schedule: start/end, grace and source (`COMPANY` / `OVERRIDE`), plus the next 14 days with each day's type (`WORKING` / `HALF` / `OFF` / `HOLIDAY` / `ON_LEAVE`) and scheduled times |
| GET | `/employees/:id/schedule` | COMPANY_ADMIN, HR, MANAGER (own team) | `{ schedule, override }`: the effective schedule, and the override or null |
| PUT | `/employees/:id/schedule` | COMPANY_ADMIN, HR | Set or replace the override `{ startTime, endTime, workingDays?, lateGraceMinutes? }`. A field left out, or null, follows the company again. `workingDays` needs all seven days. Not on your own schedule. Audited as `SCHEDULE_UPDATED`, unless nothing changed. |
| DELETE | `/employees/:id/schedule` | COMPANY_ADMIN, HR | **204**. Remove the override and go back to the company default. Not on your own schedule. Audited as `SCHEDULE_REMOVED`, unless there was none. |

## Office attendance (module `attendance`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/attendance/me/today` | any employee | Home card state: the current work date, the effective schedule, the current record (or null; architecture §1.3), `nextAction` (`CHECK_IN` / `CHECK_OUT` / `DONE` / `DAY_CLOSED`), `gpsRequired` (whether this tap should read the location) and `officeSite` (`{ id, name, radiusMeters }`, or null if there's none or several; architecture §2). No coordinates. `openVisit` (`{ id, siteName, checkInAt }`, or null, and always null with `sites` off): the visit a day check-out would also close. If its site requires GPS, `gpsRequired` is true before a check-out. |
| POST | `/attendance/check-in` | any employee | Body `{ clientRequestId: uuid, location?: { latitude, longitude, accuracy, mocked, capturedAt }, clientTime? }`. The server picks the work date and computes the status. **201** with the record; **200** with the existing record if it's a retry with the same `clientRequestId`. **409** `ALREADY_CHECKED_IN` (with the existing record in `details.record`) / `ALREADY_CHECKED_OUT` / `DAY_ALREADY_CLOSED`, checked before GPS. It runs the GPS rules (architecture §3.2): **422** `LOCATION_REQUIRED` / `OUTSIDE_SITE_RADIUS` / `MOCK_LOCATION_DETECTED` (audited as `ATTENDANCE_CHECKIN_REJECTED`, with no coordinates). A `location` sent when no check applies is discarded. A malformed one is **400**. |
| POST | `/attendance/check-out` | any employee | Body `{ location?, clientTime? }`. Closes the current record (architecture §1.3), which may be from yesterday on a night shift, and computes `workedMinutes` and `earlyLeaveMinutes`. **409** `NOT_CHECKED_IN` / `ALREADY_CHECKED_OUT` / `DAY_ALREADY_CLOSED`. GPS problems only add flags here and never reject (architecture §3.2). It also closes any open site visit, in the same transaction, judged by that visit's own site (architecture §1.6). |
| GET | `/attendance/me` | any employee | My records, newest first, with optional `from`/`to` (dates, max 93 days apart when both are sent) and pagination. Includes my own coordinates. |
| GET | `/attendance/team` | MANAGER | Direct reports' records, with the same row and filters as below. `employeeId` is narrowed to the team. No raw coordinates. |
| GET | `/attendance` | COMPANY_ADMIN, HR | All records, newest day first, then by name. Each row adds `employeeName`, `employeeCode`, `departmentName`, `siteName` and `siteVisitFlags` (`ON_ABSENT_DAY` while the row is still `ABSENT`; empty with `sites` off). Filters: `date` or `from`/`to` (not both), `employeeId`, `departmentId`, `status`, `flag`. No raw coordinates in the list. It only has rows that exist: employees with none yet appear in the daily report (step 2.11). |
| GET | `/attendance/:id` | owner, their MANAGER, COMPANY_ADMIN, HR | `{ record, employee: { name, code }, siteName, siteVisits, corrections }`. Coordinates are included for the owner and HR/Company Admin only, on the record and the visits. `siteVisits` is empty with `sites` off. `corrections` is newest first, and never has coordinates. |
| POST | `/attendance` | COMPANY_ADMIN, HR | Create a record for a day that has none: `{ employeeId, workDate, checkInAt, checkOutAt?, siteId?, reason }`. **201** `{ record }`. **409** `ATTENDANCE_RECORD_EXISTS` with `details.recordId` if a row exists (correct it instead). **400** `CANNOT_CORRECT_OWN_ATTENDANCE` if it's the caller's own. **400** `VALIDATION_ERROR` before the joining date, or for the time limits in architecture §1.7. Links that day's unlinked visits. Audited as `ATTENDANCE_CREATED_BY_HR`, and notifies the employee. |
| PATCH | `/attendance/:id/correct` | COMPANY_ADMIN, HR | `{ checkInAt?, checkOutAt?, siteId?, reason }` (reason at least 5 chars; `siteId: null` clears the office). **200** `{ record }`. Recomputes the status, writes `attendance_corrections` + audit, and notifies the employee. A row that is `ABSENT` / `ON_LEAVE` / `HOLIDAY` can be given times, which turns it into `PRESENT` / `LATE`. Self-correction is blocked as above. **400** `NOTHING_TO_CORRECT` if the values are the same; **409** `RECORD_CHANGED` if the row changed meanwhile. Time limits: architecture §1.7. |

## Sites (module `sites`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/sites` | any | Paginated, sorted by name. Employees and managers: active sites only, with `id, name, type, address, gpsRequired, radiusMeters, hasCoordinates`; `active` is ignored for them. From step 2.10, sites from my open tasks come first, marked `fromMyTasks`. HR and Company Admin: all sites including inactive, with coordinates. Filters `type`, `active` (`true`/`false`), `q` (name or address). |
| GET | `/sites/:id` | any (employees: active only) | `{ site }`, with the same fields as the list for that role |
| POST | `/sites` | COMPANY_ADMIN, HR | Create `{ name, type, address?, latitude?, longitude?, radiusMeters?, gpsRequired? }`. Missing radius/gpsRequired come from company defaults. **201** `{ site }`. **409** `SITE_NAME_TAKEN`. Audited as `SITE_CREATED`. |
| PATCH | `/sites/:id` | COMPANY_ADMIN, HR | Edit any of those fields. The location rules (architecture §2) are checked on the combined values. **409** `SITE_NAME_TAKEN`. Audited as `SITE_UPDATED` (before/after of the changed fields); a save that changes nothing writes no audit row. Changing coordinates or radius doesn't re-evaluate past visits. |
| PATCH | `/sites/:id/status` | COMPANY_ADMIN, HR | `{ isActive }`. Deactivating doesn't close open visits (they close normally). Audited as `SITE_STATUS_CHANGED`, unless it's already in that state. |
| DELETE | `/sites/:id` | COMPANY_ADMIN, HR | **204**. Only if nothing references it; otherwise `409 SITE_IN_USE` (deactivate instead). Audited as `SITE_DELETED`. |

## Site visits (module `sites`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/site-visits/check-in` | any employee | `{ siteId, clientRequestId, location?, note? }`. Uses the GPS rules with the site's settings. Starts the attendance day if there's no record for the work date. If the employee already checked in (office), only the visit is recorded. If the day is closed, only the visit is recorded and it's flagged `AFTER_HOURS`; if the day was marked `ABSENT`, it's flagged `ON_ABSENT_DAY` instead (architecture §1.6, Q2). Notifies the manager (`SITE_CHECKED_IN`). **201** `{ visit }`, or **200** on a retry with the same `clientRequestId`. **409** `VISIT_ALREADY_OPEN`, with `details.visit` (`{ id, siteName }`), checked before GPS; **404** for an inactive, office or unknown site; **422** for the GPS errors. With `attendance` off, no attendance row is touched. A location for a site that doesn't require GPS is discarded. A `note` is at most 500 characters. |
| POST | `/site-visits/:id/check-out` | visit owner | `{ location?, note? }` → computes `durationMinutes`. **409** `VISIT_NOT_OPEN`. Anyone else gets 404. GPS problems only add flags. A note is added to the check-in's note, on a new line. Doesn't end the attendance day. |
| GET | `/site-visits/me` | any employee | My visits (`from`/`to`, paginated) |
| GET | `/site-visits/me/open` | any employee | `{ visit, gpsRequired }`: my open visit or `null`, and whether checking out of it should read the location. A summary of it is also in `/attendance/me/today`, but this one works with `attendance` off. |
| GET | `/site-visits/team` | MANAGER | Direct reports' visits. Filters `from`/`to`, `employeeId`, `siteId`, `openOnly`. No raw coordinates. |
| GET | `/site-visits` | COMPANY_ADMIN, HR | All visits, same filters |
| GET | `/site-visits/:id` | owner, their MANAGER, COMPANY_ADMIN, HR | `{ visit, corrections }`. Coordinates for the owner and HR/Admin only. The web's detail view is offered to HR and Company Admin only. |
| PATCH | `/site-visits/:id/correct` | COMPANY_ADMIN, HR | `{ checkInAt?, checkOutAt?, reason }`. **200** `{ visit }`. Same rules as attendance correction. A check-out closes an open or auto-closed visit. Audited as `SITE_VISIT_CORRECTED`, and notifies the employee. |

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
| DELETE | `/tasks/:id` | creator (as above), COMPANY_ADMIN, HR | Hard delete. Tasks aren't sensitive, so it isn't audited (decided, Q22). |

## Push devices & notification settings (no module gate)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/push-devices` | any company user | `{ expoPushToken, platform: "ANDROID" \| "IOS", deviceName? }`. Upsert by token; moves it to the caller if it belonged to someone else. **200** `{ device }`. Token validated with `Expo.isExpoPushToken` (`expo-server-sdk`). |
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
| GET | `/reports/attendance/daily` | COMPANY_ADMIN, HR, MANAGER (team) | `?date=YYYY-MM-DD` (default today, company time), plus `departmentId`, `status`. One row per in-scope active employee (architecture §6), with totals per status. An `ABSENT` row with an `ON_ABSENT_DAY` visit carries that flag in `siteVisitFlags`. Paginated. |
| GET | `/reports/attendance/daily/export` | same | Same filters → `text/csv` attachment `attendance-YYYY-MM-DD.csv`. Audited as `REPORT_EXPORTED`. |
| GET | `/reports/attendance/monthly` | COMPANY_ADMIN, HR, MANAGER (team) | `?month=YYYY-MM`, `departmentId`. Per employee: `presentDays, lateDays, absentDays, onLeaveDays, holidayDays, incompleteDays, totalWorkedMinutes`. Paginated. |
| GET | `/reports/attendance/monthly/export` | same | CSV `attendance-summary-YYYY-MM.csv`. Audited. |
| GET | `/reports/site-visits` | COMPANY_ADMIN, HR, MANAGER (team) | `from`, `to` (max 93 days), `siteId`, `employeeId`, `flag`. Paginated visit rows with duration and flags (including `AFTER_HOURS` and `ON_ABSENT_DAY`). |
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
  last tick was under 2 minutes ago. `lastTickAt` is null if no worker has ever run. It still
  answers 200 with the worker down.
- No job data is exposed.

## Error codes added in Phase 2
| Code | Status | Meaning |
|---|---|---|
| `MODULE_DISABLED` | 403 | The module is off for this company |
| `NO_EMPLOYEE_PROFILE` | 403 | A self-service attendance/site endpoint was called by a user without an employee profile |
| `ALREADY_CHECKED_IN` / `ALREADY_CHECKED_OUT` | 409 | One check-in/out pair per work date |
| `NOT_CHECKED_IN` | 409 | Check-out with nothing to close |
| `DAY_ALREADY_CLOSED` | 409 | The day has closed (auto-closed, past its close time, or already written by day close); ask HR |
| `VISIT_ALREADY_OPEN` / `VISIT_NOT_OPEN` | 409 | Site visit state |
| `SITE_IN_USE` | 409 | Delete blocked; deactivate instead |
| `SITE_NAME_TAKEN` | 409 | Another site in this company has that name, ignoring case (inactive ones count) |
| `LOCATION_REQUIRED` | 422 | GPS-required site, no location sent |
| `OUTSIDE_SITE_RADIUS` | 422 | `details: { distanceM, radiusM, siteName }` |
| `MOCK_LOCATION_DETECTED` | 422 | Android reported a mock location |
| `CANNOT_CORRECT_OWN_ATTENDANCE` | 400 | Self-correction blocked |
| `CANNOT_SET_OWN_SCHEDULE` | 400 | Setting or removing your own schedule override is blocked |
| `NOTHING_TO_CORRECT` | 400 | The correction's values are the ones already stored |
| `RECORD_CHANGED` | 409 | The record or visit changed after this request read it |
| `ATTENDANCE_RECORD_EXISTS` | 409 | That employee already has a row for that day; `details.recordId` |
