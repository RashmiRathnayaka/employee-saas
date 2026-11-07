# Permissions — Phase 2 role × action matrix

**Status: design approved; open questions resolved 2026-11-03 (see
`plan.md`).**

The legend and rules are the same as `docs/permissions.md`:
- ✅ allowed · 🔶 allowed, scoped (see note) · ❌ not allowed.
- **Deny by default.** It's enforced in the API service layer; the UI only
  hides things.
- Out-of-scope or cross-tenant resources return 404.

Scoping words:
- **Own**: the caller's own employee profile (`users.employeeId`). A user
  without an employee profile has no "own" attendance, visits or tasks.
- **Own team**: employees whose `managerId` is the caller's `employeeId`
  (direct reports only, as in Phase 1).
- **All**: everyone in the caller's company.

`SUPER_ADMIN` has **no access** to any Phase 2 company data: attendance,
locations, sites, tasks, schedules, push devices or reports. It is a
platform role with no `companyId`. Every row below is ❌ for it, so the
column is left out of the tables. The only Phase 2 thing it can see is
`/health` (worker status, no company data).

Every action also requires its module to be enabled (`MODULE_DISABLED`
otherwise), and the company's settings page shows the module switches.

## Company settings (Phase 2 fields)

| Action | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|
| Enable / disable modules (attendance, sites, tasks) | ✅ | ❌ | ❌ | ❌ |
| Edit default schedule, grace, auto-checkout, reminders, GPS accuracy/retention | ✅ | ❌ | ❌ | ❌ |
| View those settings | ✅ | ✅ | 🔶 read-only | 🔶 read-only |

## Schedules

| Action | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|
| View own effective schedule | ✅ | ✅ | ✅ | ✅ |
| View an employee's schedule | ✅ all | ✅ all | 🔶 own team | ❌ |
| Set / remove a per-employee override | ✅ | ✅ | ❌ | ❌ |

Nobody can set or remove their own override, as with correcting their own attendance:
another HR user or Company Admin must do it (`CANNOT_SET_OWN_SCHEDULE`). A manager's own
schedule is `/schedule/me`, because `/employees/:id/schedule` covers their team, not them.

## Office attendance

| Action | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|
| Check in / check out for self (mobile) | 🔶 if has employee profile | 🔶 own | 🔶 own | 🔶 own |
| View own records (incl. own coordinates) | 🔶 if has profile | ✅ | ✅ | ✅ |
| View team records (times, status, distance, within-radius, flags) | ❌ | ❌ | 🔶 own team | ❌ |
| View all records | ✅ | ✅ | ❌ | ❌ |
| View raw coordinates of someone else's check-in/out | ✅ (detail view) | ✅ (detail view) | ❌ | ❌ |
| Correct a record / create a missing one (reason required, audited) | ✅ not own | ✅ not own | ❌ | ❌ |
| Correct own record | ❌ | ❌ | ❌ | ❌ |
| Set a status directly (bypassing times/leave/holidays) | ❌ | ❌ | ❌ | ❌ |

COMPANY_ADMIN can see and correct all attendance, like HR. Attendance is
an admin concern, unlike medical documents.

## Sites

| Action | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|
| Create / edit / activate / deactivate / delete-if-unused | ✅ | ✅ | ❌ | ❌ |
| List active sites (to pick one) | ✅ | ✅ | ✅ | ✅ |
| See inactive sites and site coordinates in the admin list | ✅ | ✅ | ❌ | ❌ |

Employees aren't shown site coordinates in the list. The app only needs
the name, address and "GPS required". The server does the distance maths.

## Site visits

| Action | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|
| Check in / check out at a site for self | 🔶 if has profile | 🔶 own | 🔶 own | 🔶 own |
| View own visits (incl. own coordinates) | 🔶 if has profile | ✅ | ✅ | ✅ |
| View team visits (no raw coordinates) | ❌ | ❌ | 🔶 own team | ❌ |
| Get notified when a team member checks in at a site | ❌ | ❌ | 🔶 own team | ❌ |
| View all visits (coordinates in detail view) | ✅ | ✅ | ❌ | ❌ |
| Correct a visit (reason required, audited) | ✅ not own | ✅ not own | ❌ | ❌ |

## Tasks

| Action | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|
| Create a task | ✅ for anyone | ✅ for anyone | 🔶 for own team (or self) | ❌ |
| Edit / reassign / delete a task | ✅ any | ✅ any | 🔶 tasks they created, while the assignee is on their team | ❌ |
| Update status of a task | ✅ any | ✅ any | 🔶 own team's tasks + own | 🔶 tasks assigned to self |
| View tasks | ✅ all | ✅ all | 🔶 own team + own + created by self | 🔶 assigned to self |

An employee can only change a task's **status**, not its title,
description, due date or assignee.

## Reports & exports

| Action | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|
| Daily attendance report | ✅ all | ✅ all | 🔶 own team | ❌ |
| Monthly attendance summary | ✅ all | ✅ all | 🔶 own team | ❌ |
| Site visit history report | ✅ all | ✅ all | 🔶 own team | ❌ |
| CSV export of the above (audited; never contains raw coordinates) | ✅ | ✅ | 🔶 own team | ❌ |
| Dashboard attendance / site / task tiles | ✅ all | ✅ all | 🔶 own team | ❌ |

Employees see their own history in the app (`/attendance/me`,
`/site-visits/me`), not through reports.

## Push devices & notification settings

| Action | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|
| Register / unregister own device token | ✅ | ✅ | ✅ | ✅ |
| View / change own push settings | ✅ | ✅ | ✅ | ✅ |
| View or manage anyone else's devices or settings | ❌ | ❌ | ❌ | ❌ |

## Audit log (Phase 2 actions)

| Action | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|
| View attendance / site / schedule / export audit entries | ✅ | ✅ (HR's audit filter is extended with these entity types) | ❌ | ❌ |

New audited actions:
- `ATTENDANCE_CORRECTED`, `ATTENDANCE_CREATED_BY_HR`, `SITE_VISIT_CORRECTED`
- `ATTENDANCE_CHECKIN_REJECTED` (mock location only, no coordinates)
- `SITE_CREATED`, `SITE_UPDATED`, `SITE_STATUS_CHANGED`, `SITE_DELETED`
- `SCHEDULE_UPDATED`, `SCHEDULE_REMOVED`
- `REPORT_EXPORTED`
- `COMPANY_SETTINGS_UPDATED` (existing; now also covers module toggles)

These are **not** audited:
- plain check-ins and check-outs (the attendance row itself is the record);
- task changes;
- push registrations.
