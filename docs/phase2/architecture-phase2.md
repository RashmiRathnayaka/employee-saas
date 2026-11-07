# Architecture — Phase 2 (Attendance & Site Management)

**Status: design approved. The open questions were resolved by the
developer on 2026-11-03 (see `plan.md` → "Resolved questions").**
Implemented so far: step 2.1 (module gating, settings, shared helpers), step
2.2 (sites), step 2.3 (office attendance), step 2.4 (GPS verification and the
privacy disclosure), step 2.5 (site visits), step 2.6 (HR views, corrections and
schedule overrides) and step 2.7 (the job runner and day close).

This adds to `docs/architecture.md`. Everything in it still holds: tenant
scope from the token only, `getTenantPrisma`, audit in the same transaction,
calendar dates vs timestamps (§8). Tables are in
`database-schema-phase2.md`, endpoints in `api-phase2.md`, roles in
`permissions-phase2.md`.

`docs/architecture/platform.md` (the central identity design) doesn't exist
yet. §7 below lists what Phase 2 does to stay out of its way.

---

## 0. Module gating

A new middleware, `requireModule("attendance" | "sites" | "tasks")`, runs
right after `requireAuth` on every Phase 2 router.
- It reads `company_settings.enabledModules` for `req.auth.companyId`, with
  a short in-process cache (30 s) so it isn't a DB hit on every request.
- `PATCH /company/settings` **merges** `enabledModules` into the stored
  value, so sending `{ attendance: true }` leaves `sites` and `tasks` alone.
  Only the three known keys are accepted. The saving instance drops its
  cache entry after the commit, so the change applies there at once. Other
  API instances see it within the 30 s cache lifetime.
- Off → `403 { error: { code: "MODULE_DISABLED", message, details: { module } } }`.
- **Default: off** (decided, Q1). A missing key in `enabledModules` means
  disabled, so new companies start with attendance, sites and tasks off
  until a Company Admin switches them on.
  - **Seed:** ACME gets `attendance`, `sites` and `tasks` **on**, for
    testing the features. BETA keeps them **off**, for testing the
    `MODULE_DISABLED` path.
  - The seed sets these only when it first creates a company's settings
    row, like every other seed upsert. Running it on an existing DB never
    overwrites what an admin chose. The dev DB already exists and is not
    reseeded (decided by the developer, 2026-11-06), so ACME's modules
    there are switched on from the web settings page (step 2.1).
- The check runs before any resource lookup. A disabled module therefore
  answers 403 even for an id from another company. That leaks nothing,
  because it's about the caller's own company.
- `GET /company/settings` already returns `enabledModules`. Web and mobile
  hide tabs, menu items and dashboard tiles from it, using a shared
  `isModuleEnabled(settings, key)` helper.
- Mapping:
  - `attendance`: office attendance, schedules, corrections, attendance
    reports, check-in reminders, day close.
  - `sites`: sites, site visits, site reports.
  - `tasks`: tasks.
  - With `sites` off, `tasks.siteId` is ignored on write and hidden on read.
  - With `attendance` off, a site visit doesn't start an attendance day.
- Jobs check the flag too. A company with `attendance` off gets no
  reminders, no absent marking and no auto-close.

---

## 1. Attendance rules

### 1.1 The model: one record per employee per work date
- **`workDate`** is the company-local calendar date **the shift starts on**.
- There is **one check-in and one check-out per work date** (no
  lunch-break out/in pairs). It's the simplest model that covers the
  requirement, and it makes double check-in structurally impossible
  (unique index). Multiple sessions per day would need a child table; it's
  not in Phase 2 (decided, Q3).
- **Who can check in.** Anyone with an employee profile, an active login
  and the `attendance` module on. That includes HR and managers, who are
  employees too. Check-in happens in the mobile app only; the web portal
  has no check-in button in Phase 2.

### 1.2 Effective schedule for a date
`getEffectiveSchedule(employeeId, workDate)` is the one function that
answers "what were they supposed to work?":
1. `employee_schedules` override if present, else company defaults
   (`workStartTime`, `workEndTime`, `lateGraceMinutes`, `workingDays`).
2. Day weight from `workingDays[weekday]`:
   - `OFF` → non-working day.
   - `HALF` on an **override** → the first half of the override's own shift:
     22:00-06:00 becomes 22:00-02:00, and 11:00-19:00 becomes 11:00-15:00. An odd minute
     rounds down. `halfDayEndTime` isn't used. Lateness, early leaving and the close time
     all follow from this end, and the day-close job (step 2.7) must take its schedule
     from this same function, not work one out itself.
   - `HALF` on **company hours** → end time is `halfDayEndTime`. If they start at or after
     it, the day is worked in full. If they already end before it, they keep their own end.
   - Half-day leave doesn't change the times: it's flagged, and not judged late or early.
   - Leave balances still count days from the company's `workingDays`, not an override's.
3. `company_holidays` on that date → non-working day.
4. Approved leave covering that date:
   - full day → "on leave";
   - `startHalfDay`/`endHalfDay` on that date → "half-day leave" (no
     lateness computed; decided, Q8).
5. The result has `scheduledStartAt` and `scheduledEndAt` as **UTC instants**.
   - They're built with a new shared helper,
     `zonedDateTimeToUtc("2026-11-03", "09:00", "Asia/Colombo")`.
   - If `endTime <= startTime`, the end is on `workDate + 1` (night shift).

`zonedDateTimeToUtc` goes in `packages/shared/src/dates.ts`. It uses only
`Intl.DateTimeFormat` (no new library) and is tested under
`TZ=Asia/Colombo` and `TZ=UTC`, plus a DST zone (`Europe/London`) for the
day the clocks change.

Two wall-clock times need a rule on the days clocks change:
- **A time that doesn't exist** (clocks jump 01:00 → 02:00, so 01:30 never
  happens) moves forward by the size of the jump: 01:30 becomes 02:30 local.
- **A time that happens twice** (clocks go back, so 01:30 happens twice)
  means the **first** one. A shift can't start late because of a clock
  change.

### 1.3 Which work date does a check-in belong to?
- For a **day shift**, it's simply the local date of the check-in.
- For a **night shift crossing midnight** (e.g. 22:00–06:00), a check-in at
  23:50 on the 3rd and one at 00:20 on the 4th must both count as the shift
  that starts on the 3rd.

The rule:
1. Take the local date `D` of "now".
2. If the employee's effective schedule for `D − 1` crosses midnight, and
   now is before `scheduledEnd(D − 1)`, the work date is `D − 1`.
3. Otherwise the work date is `D`.
4. Check-ins earlier than 4 hours before `scheduledStart(D)` are still
   accepted (early birds) and belong to `D`.

The server always decides this. The client never sends `workDate`.

**This rule answers "which shift is a *check-in* for?", not "which record do I
check out of?"** Someone on 22:00–06:00 who checks out at 06:30 gets today's date
from it, and today has no record. So the server first looks for a current record
(added in step 2.3):
1. **The employee's latest record with a check-in, if its close time hasn't
   passed.** Check-out closes this one, whatever the date is now. The same goes
   for a day-shift worker staying past midnight.
2. Otherwise, the record for the §1.3 work date, if there is one.

**Close time** is when a record stops accepting a check-out:
- `scheduledEndAt + autoCheckoutAfterMinutes`, the same moment the day close job
  uses (§5.4).
- A check-in on a non-working day has no schedule, so its close time is **16 hours
  after the check-in**, the longest shift the system allows.

Until step 2.7's job exists, nothing writes `autoClosedAt`. The rule doesn't depend
on the job having run: a record past its close time counts as closed either way.

**What the app is told to do** (`nextAction`), which also decides the check-in and
check-out errors:

| Current record | `nextAction` | Check-in answers | Check-out answers |
|---|---|---|---|
| None, and today's close time hasn't passed | `CHECK_IN` | creates the record | `NOT_CHECKED_IN` (see below) |
| None, and today's close time has passed | `DAY_CLOSED` | `DAY_ALREADY_CLOSED` | `NOT_CHECKED_IN` |
| Written by day close, with no check-in (`ABSENT`, `ON_LEAVE`, `HOLIDAY`) | `DAY_CLOSED` | `DAY_ALREADY_CLOSED` | `NOT_CHECKED_IN` |
| Checked in, still open | `CHECK_OUT` | `ALREADY_CHECKED_IN` | closes it |
| Checked in, past its close time or auto-closed | `DAY_CLOSED` | `DAY_ALREADY_CLOSED` | `DAY_ALREADY_CLOSED` |
| Checked out | `DONE` | `ALREADY_CHECKED_OUT` | `ALREADY_CHECKED_OUT` |

- **A check-in after the day's close time is refused** (confirmed by the developer,
  2026-11-06). From step 2.7, day close has already written an `ABSENT` row by then,
  and a check-in that closes at once would be useless. HR can correct the day. A
  day-shift worker's next chance is after midnight, when the work date moves on.
  People who really work nights get a per-employee schedule (step 2.6).
- **The app asks "Are you sure?" before a check-out** (decided by the developer,
  2026-11-06), because a mistaken tap can only be undone by an HR correction.
- **Check-out with no current record** normally answers `NOT_CHECKED_IN`. If the
  latest check-in is still open or auto-closed, and is from this work date or the
  day before, it answers `DAY_ALREADY_CLOSED`. That's a night worker tapping check-out
  after their close time, who needs to hear "ask HR", not "you never checked in".

### 1.4 Status
Status is computed by one pure function, `computeAttendanceStatus(record,
schedule)`, whenever a record is created, corrected or closed. A check-out changes
neither of its inputs, so it keeps the status and `lateMinutes` it has. Recomputing
there would also judge the check-in against a grace period someone may have changed
since.

| Situation | `status` | Notes |
|---|---|---|
| Checked in on or before `scheduledStart + grace` | `PRESENT` | |
| Checked in after `scheduledStart + grace` | `LATE` | `lateMinutes = checkIn − scheduledStart` (counted from the start, not from the end of grace) |
| Checked in, never checked out, day closed | `INCOMPLETE` | `lateMinutes` still kept; `workedMinutes` NULL |
| No check-in, working day, approved leave covers it | `ON_LEAVE` | Written by day close |
| No check-in, company holiday | `HOLIDAY` | Written by day close |
| No check-in, working day, no approved leave | `ABSENT` | Written by day close |
| Weekly OFF day, no check-in | *no row* | Reports show "Off" |

- **Precedence:** `INCOMPLETE` > `LATE` > `PRESENT`.
- **Present days** in reports = `PRESENT + LATE + INCOMPLETE`. Late days
  are a subset of present days.
- **`workedMinutes`** = `checkOut − checkIn` in whole minutes. There's no
  break deduction and no overtime in Phase 2.
- **`earlyLeaveMinutes`** = `scheduledEnd − checkOut` if positive. It's
  recorded and shown in reports, but it isn't a status. It stays 0 on a half-day
  leave day, for the same reason as lateness (§1.5): we don't know which half was
  taken.
- **Whole minutes round down**, and the grace boundary is inclusive: with a 09:00
  start and 10 minutes' grace, 09:10:00 is `PRESENT` and 09:10:01 is `LATE`.

### 1.5 Edge cases

| Case | Behaviour | Why |
|---|---|---|
| **Night shift crossing midnight** | Handled by the work-date rule (§1.3) and by `scheduledEndAt` being on the next day. Day close runs at `scheduledEndAt + autoCheckoutAfterMinutes`, not at midnight. | "End of day" means end of *that shift*. Closing at midnight would wrongly cut every night shift in half. |
| **Check-in on a holiday or weekly off day** | Allowed. Status is `PRESENT` (never `LATE`, since there's no schedule), flag `NON_WORKING_DAY`. | People do work holidays. Blocking them loses real data, and the flag lets a later overtime phase find these days. |
| **Check-in on an approved full-day leave day** | Allowed, status `PRESENT`/`LATE`, flag `ON_APPROVED_LEAVE`. The leave is **not** auto-cancelled and the balance isn't touched. HR sees the flag in the daily report. | Changing a leave balance is an HR decision (audited), not a side effect of a button tap. |
| **Check-in on a half-day leave day** | Allowed, `lateMinutes = 0`, flag `HALF_DAY_LEAVE`. | Phase 1 doesn't record *which* half was taken, so lateness can't be judged fairly (decided, Q8; recording morning/afternoon is a possible future leave change). |
| **Double check-in** (double tap, two devices, retry) | The unique index on `(companyId, employeeId, workDate)` rejects the second insert → `409 ALREADY_CHECKED_IN`, with the existing record in `details`. If it carries the same `clientRequestId` as the first, it's a retry and gets `200` with the existing record. | Structural, so it holds even under true concurrency, and a lost response doesn't show the employee a scary error. |
| **Check-in again after checking out the same day** | `409 ALREADY_CHECKED_OUT`. | One pair per day (§1.1). HR can correct the times. |
| **Check-out without check-in** | `409 NOT_CHECKED_IN`. The app only shows "Check out" when the current record has a check-in (§1.3), so this mostly guards against stale screens. | There's nothing to close, and inventing a check-in time would be fake data. |
| **Check-out late on a night shift** (22:00–06:00, out at 06:30) | Closes the night's record, found by the §1.3 current-record rule rather than by date. | The date has moved on, but it's still the same shift. |
| **Check-out after the day was auto-closed**, or after its close time | `409 DAY_ALREADY_CLOSED`. The app says "Your day was closed automatically. Ask HR to correct it." | Accepting a check-out hours later would produce an unreal `workedMinutes`. HR corrections have a reason and an audit trail. |
| **Forgot to check out yesterday, checking in today** | Allowed once yesterday's close time has passed. Today gets its own record; yesterday's stays open until day close (step 2.7) marks it `INCOMPLETE`. | Yesterday's mistake must not block today's attendance. |
| **Shift longer than 16 h** | Flag `LONG_SHIFT`. Rare through check-out, because the close time normally comes first, but a long `autoCheckoutAfterMinutes` or a very early check-in can reach it. Through an HR correction it's allowed with the same flag. | It's real data, so it's recorded and made visible rather than rejected. |
| **Phone offline** | **Phase 2 is online-only** (decided, Q4). The check-in button sends immediately; with no connection the app shows **"No internet connection, try again"** and keeps nothing queued. The same applies to check-out and site check-in/out. The server's clock is the only source of `checkInAt`. The request may include `clientTime`, which is logged for diagnosis and never trusted. | A queued offline check-in carries a phone-reported time, and the phone's clock is user-editable, so it can't be trusted for pay-relevant data. **Possible future requirement:** offline check-in for sites with no signal. It would need signed timestamps, a sync queue and conflict rules, so it would be its own step. |
| **Flaky network (request sent, response lost)** | The app keeps the `clientRequestId` for that tap and resends it on retry. The server returns the same record. | Safe retry without double records. |
| **Employee deactivated mid-shift** | Open record → closed by the deactivation transaction as `INCOMPLETE` with `AUTO_CLOSED`. | The same transaction already cancels pending leave in Phase 1. |
| **Day close before joining date / after deactivation** | No row is written. | Not absent: not employed that day. |
| **Leave approved after the day was marked ABSENT** | Flipped to `ON_LEAVE` in the leave approval transaction (schema doc, "cross-module effects"). | Sick leave is usually filed after the fact. |
| **Schedule changed after the fact** | Past records keep their `scheduledStartAt`/`scheduledEndAt` snapshot. | Lateness is judged against the rule that was in force. |
| **Server clock vs company timezone** | All rules use UTC instants, plus `companies.timezone` only to turn wall times into instants. The server's own `TZ` is irrelevant, and tests run under two TZs. | Same rule as Phase 1 (`architecture.md` §8). |

### 1.6 Site visits and the attendance day
This section was decided in Q2.
- A field worker may go straight to a customer site. If the `attendance`
  module is on and the employee has no attendance record for the current
  work date, **the first site check-in also starts the attendance day**.
  It creates `attendance_records` with `source = SITE_VISIT`, the same
  `checkInAt`, and lateness judged normally. Both rows are written in one
  transaction.
- **If the employee already checked in at the office** (a record with a
  check-in exists), the site check-in **only records the visit**. The
  attendance record isn't changed.
- **If the day is already closed**, the visit is still recorded and linked
  to that day's record. It doesn't reopen or change the record. The visit
  gets the flag **`AFTER_HOURS`**, so it stands out in HR reports (decided
  by the developer, 2026-11-06).
  - "Closed" means the record has a `checkOutAt` or an `autoClosedAt`.
  - It also covers a record day close wrote with no check-in as `ON_LEAVE` or
    `HOLIDAY`: day close has already run for that date. HR can correct the
    record if the person really was working.
  - The flag goes on the **visit** (`site_visits.flags`), not on the
    attendance record.
  - It isn't a rejection, and the manager still gets `SITE_CHECKED_IN`.
- **If day close already marked the day `ABSENT`**, the visit is recorded and
  linked to that row, and the row is left alone. The visit gets the flag
  **`ON_ABSENT_DAY`** instead of `AFTER_HOURS` (decided by the developer,
  2026-11-06).
  - The system says they were absent, but they were on site. That's a
    contradiction for a person to resolve, so it stands out in the **HR daily
    report** (§6), and HR can correct the row.
  - The flag stays on the visit as a record of what happened. The daily report
    only shows it while the row is still `ABSENT`, so it disappears once HR
    corrects the row or approved leave flips it to `ON_LEAVE`.
  - It isn't a rejection, and the manager still gets `SITE_CHECKED_IN`.
- **If the close time has passed and there's no row yet** (day close hasn't written
  one, or until step 2.7, can't), the visit is recorded and flagged `AFTER_HOURS`, with
  no `attendanceRecordId`, and no row is created (settled in step 2.5). An office
  check-in at that moment would be refused (§1.3), so a visit can't start the day
  either (confirmed by the developer, 2026-11-06). Its `workDate` is still set. When day
  close writes that date's row it links the visit: on `ABSENT` the flag becomes
  `ON_ABSENT_DAY`, and on `ON_LEAVE` or `HOLIDAY` it stays `AFTER_HOURS`, the same as a
  visit made after the row existed. If HR creates that day's record first, the create
  links it (step 2.6), keeping the flag.
- **If a row later becomes `ABSENT`** (leave revoked, holiday deleted), a linked `AFTER_HOURS`
  visit becomes `ON_ABSENT_DAY`, so HR sees it.
- **The app asks "Check in at <site>?" before a site check-in** (decided by the developer,
  2026-11-06), because it notifies the manager, can record the location and can start the
  day. On a first use, the location disclosure comes after that answer.
- **With `attendance` off** (§0), a visit touches no attendance row and gets neither
  flag. Its `workDate` is the company-local date.
- The flags come from `nextAction`, the same answer the Home card and an office
  check-in use (`getVisitDayEffect` in `siteVisits.rules.ts`), so they can't disagree.
- The day is ended by the normal "Check out for the day" or by auto-close.
- Checking out of a site **does not** end the attendance day, because
  another visit may follow.
- Only one site visit can be open at a time. Starting a new one while
  another is open → `409 VISIT_ALREADY_OPEN`, and the app offers "Check out
  of <site> first".
- **Day check-out with an open site visit**: the visit is closed at the
  same instant, with the same location, in the same transaction.
  - Each is judged by its own site: a location is kept for the record only if its
    office requires GPS, and for the visit only if its site does (Q6). So
    `/attendance/me/today`'s `gpsRequired` is true before a check-out if either does.
  - It's closed even if the `sites` module has been switched off since, because
    nothing else could close it then. No position is kept in that case.
  - The app's "Are you sure?" says the visit closes too.
- **Manager notification:** on site check-in, the employee's manager gets
  an in-app notification `SITE_CHECKED_IN` ("Alex checked in at Site X,
  10:42"), plus push from step 2.9. This is sent only if the manager has an
  active login. HR isn't notified, to avoid noise; HR uses the site report.
  It's written in the same transaction as the visit, like Phase 1
  notifications.

### 1.7 HR corrections
- HR and Company Admin can:
  - change `checkInAt` / `checkOutAt` (and the office site) of a record;
  - create a record for a day that has none;
  - correct a site visit's times.
- A `reason` (at least 5 characters) is required. Each correction writes
  `attendance_corrections` (before/after) and `audit_logs` in one
  transaction, and the status is recomputed.
- HR **cannot set a status directly**:
  - `ON_LEAVE` only comes from approved leave;
  - `HOLIDAY` only from the holiday calendar;
  - everything else from times.

  This keeps the status consistent with its sources.
- **Self-correction is blocked**: an HR user can't correct their own
  attendance. This uses the same `employeeId` comparison as self-approval
  in Phase 1.
- Corrected values are **never GPS-verified**. GPS columns stay as captured
  (or NULL for HR-created rows), and `isCorrected = true` shows in every
  view.
- The employee gets an `ATTENDANCE_CORRECTED` notification with the reason.

**Details settled in step 2.6:**
- **What a correction is judged against:** the record's own schedule snapshot, so a schedule
  changed since doesn't rewrite the day. The snapshot has no grace period, so lateness uses
  the employee's grace period as it is now.
- **A row with no check-in** (`ABSENT`, `ON_LEAVE`, `HOLIDAY`) needs a check-in time. It
  takes today's schedule for that date if it has no snapshot, earns the flags a check-in
  that day would have (`NON_WORKING_DAY`, `ON_APPROVED_LEAVE`, `HALF_DAY_LEAVE`), and its
  `source` becomes `HR`.
- **Limits on the times**, since they're not GPS-checked: not in the future; check-out after
  check-in, and within 24 hours of it (further apart is a mistyped date); and the check-in
  on the work date in company time. A night shift's check-in may be on the next day. A
  visit's may too, because a visit doesn't record its shift.
- **A check-out can be changed but not removed.** A mistaken check-out is fixed by
  setting the real time.
- **Nothing changed:** `400 NOTHING_TO_CORRECT`, with no history, no `isCorrected` and no
  notification.
- **Two people at once:** the write is conditional on the row's `updatedAt`, so a
  correction can't silently overwrite an employee's check-out or another correction. The
  loser gets `409 RECORD_CHANGED`.
- **A record created by HR** is judged like a check-in that day, using the employee's override
  if any, and can't be before the joining date. It's `isCorrected`, `source = HR`, with
  `before` null in the history.
- **Correcting a visit** changes only its times, duration and status. A check-out closes
  an `OPEN` or `AUTO_CLOSED` visit. Its flags and its attendance record stay as they are:
  each has its own correction. Correcting a record's check-out doesn't close an open visit.
- **The office** must be an `OFFICE` site of this company, inactive ones included, since a
  past day may have been at one. Naming one with `sites` off answers `MODULE_DISABLED`.

---

## 2. Sites
- HR and Company Admin manage sites:
  - name, type (`OFFICE` / `EXTERNAL`), address, latitude/longitude,
    radius (25–5000 m), GPS required, active.
- New sites take `radiusMeters` and `gpsRequired` defaults from
  `company_settings.gpsRadiusMeters` / `gpsCheckinEnabledDefault`.
- **Location rules** (checked on the combined values of a partial edit):
  latitude and longitude are set together or not at all, and a GPS-required
  site must have them. So switching on GPS by default means a new site needs
  coordinates too, unless the form unticks "GPS required".
- **Site names** are unique per company, ignoring case, and that includes
  inactive sites, so a deactivated site's name can't be reused.
- **Deleting** relies on the foreign keys. Every later table that references a
  site uses `ON DELETE RESTRICT`, and the API turns that database error into
  `409 SITE_IN_USE`. So no later step has to remember to extend a "does anything
  use this site?" check.
- Coordinates are entered as numbers. The web form shows an
  "Open in Google Maps" link to check them. There's no map widget and no
  new library; HR can copy coordinates from Google Maps (right-click → the
  coordinates line).
- **Which sites an employee can pick:** all active `EXTERNAL` sites in the
  company. `GET /sites` returns every active site, and the step 2.5 picker asks
  for `?type=EXTERNAL`. `POST /site-visits/check-in` enforces this too: an office
  or an inactive site gets the same 404 as an unknown one. Sites from the
  employee's open tasks are listed first (added with tasks, in step 2.10). There
  are no per-employee site assignments in Phase 2 (decided, Q5).
- **Office attendance and GPS:**
  - If the company has no active `OFFICE` site, office check-in has no GPS
    at all (flag `NO_OFFICE_SITE`).
  - Otherwise the server compares the location with the **nearest** active
    `OFFICE` site and applies that site's `gpsRequired` / `radiusMeters`.
  - The app doesn't ask the employee to pick an office.
  - **Details settled in step 2.4** (`apps/api/src/lib/gpsVerification.ts`):
    - **With the `sites` module off, there are no offices**, so the flag is
      `NO_OFFICE_SITE`. An admin can't see or edit sites then, so a leftover
      GPS-required office mustn't lock anyone out.
    - **One office that doesn't require GPS:** `checkInSiteId` is that office.
      **Several that don't:** it's NULL. No location is kept for them (Q6), so the
      nearest can't be known, and picking one would be a guess.
    - **If any office requires GPS, the app must send a location.** A tap without
      one can't be placed, and treating it as "no check" would let anyone skip the
      check by turning location off.
    - **A mocked fix is only compared with offices that require GPS**, so a fake
      position next to an office that doesn't check can't skip the check.
    - **An office with no coordinates can't be the nearest.** So in a company that
      has one, next to an office that requires GPS, someone at the first is judged
      against the second and refused. Give every office coordinates in that case.
    - **Check-out is compared with the office its check-in used**, not the nearest
      one at that moment, and only if that office requires GPS now. A record with no
      `checkInSiteId` isn't checked at check-out.
  - **`/attendance/me/today` doesn't know the phone's location**, because it's only
    read on a tap. So its `gpsRequired` means "this tap should read the location":
    before check-in, any active office requires GPS; before check-out, the check-in's
    office does. `officeSite` is the only office or the check-in's office, otherwise
    null. It never has coordinates.

---

## 3. GPS verification and privacy

### 3.1 What is captured, and when
- **Foreground only, only at the moment of a check-in or check-out tap.**
  - The app asks for **foreground** location permission only
    (`requestForegroundPermissionsAsync`).
  - `app.json` sets the `expo-location` plugin so the Android build contains
    **no** `ACCESS_BACKGROUND_LOCATION` permission, and iOS has no "Always"
    usage string.
  - There is no `watchPositionAsync` and no background task.
- **Location is requested only when the site needs it.** That means the
  office site (for day check-in) or the chosen site (for a visit) has
  `gpsRequired = true`.
  - Otherwise the app doesn't ask for a location and the server stores none.
  - If a client sends a location anyway, the server **discards it before
    saving** and a test asserts the GPS columns stay NULL. So the rule
    doesn't depend on the app behaving.
  - This is data minimisation: don't collect what you won't use. Decided in
    Q6: no "collect and flag" at sites that don't require GPS.
- **What's sent:** `{ latitude, longitude, accuracy, mocked, capturedAt }`,
  from one `getCurrentPositionAsync({ accuracy: High })` call.
  - It has a 15 s timeout, after which it falls back to the best fix it got.
- **The server calculates** the haversine distance to the site, from the
  site's stored coordinates. It stores lat, lng, accuracy, distance,
  `withinRadius` and `mocked`.
  - The client never sends a distance or a "within" flag.
  - **Decisions use the same whole metres that are stored**, so a row always
    explains its own outcome: 201 m against a 200 m radius is outside.
  - The haversine function lives in `packages/shared`, but the app doesn't show a
    distance before submitting: employees aren't given site coordinates
    (`permissions-phase2.md`). The distance comes from the server's refusal.
  - A fix with no accuracy can't be judged, so the app treats it as no fix.

### 3.2 The three hard cases: rejected, or allowed but flagged?
These rules apply when the site has `gpsRequired = true`:
- `distance` is from the fix to the site centre.
- `accuracy` is the phone's reported radius of uncertainty.
- `max` is `company_settings.gpsMaxAccuracyMeters`.

| Case | At **check-in** | At **check-out** | Why |
|---|---|---|---|
| **No location** (permission denied, GPS off, timeout with no fix) | **Rejected** `422 LOCATION_REQUIRED`. The app explains how to turn location on. | **Allowed, flagged** (`LOCATION_UNAVAILABLE_AT_CHECKOUT`) | At check-in the employee is standing there and can fix it. A blocked check-out would leave the record open and turn into a worse `INCOMPLETE`. |
| **Outside the radius**, with a good fix (`accuracy <= max` and `distance > radius`) | **Rejected** `422 OUTSIDE_SITE_RADIUS`. `details`: `{ distanceM, radiusM, siteName }`, so the app can say "You are 850 m from Site X". | **Allowed, flagged** `OUTSIDE_RADIUS_AT_CHECKOUT` | "GPS required" must mean something. Rejecting while the person is still there gives instant feedback (wrong site picked, walk to the gate). HR can still create a corrected record with a reason for genuine exceptions. People check out as they leave, so being outside then is normal. |
| **Poor accuracy** (`accuracy > max`) | Depends on what the uncertainty circle says: **certainly inside** (`distance + accuracy <= radius`) → accepted, no flag; **certainly outside** (`distance − accuracy > radius`) → rejected `OUTSIDE_SITE_RADIUS`; **can't tell** (the circle overlaps the boundary) → **allowed, flagged `LOW_ACCURACY`**. | Allowed; flag `LOW_ACCURACY` if `accuracy > max` | Indoors, GPS accuracy is often 50–200 m. Rejecting every vague fix would lock real people out of their own office every day. When the circle overlaps the site, they may well be there, so we let them in and HR sees the flag. When even the best case is outside, it's an outside case. |
| **Mock location** (`mocked = true`; expo-location sets this on Android when the fix comes from a mock provider) | **Rejected** `422 MOCK_LOCATION_DETECTED`. An `audit_logs` row `ATTENDANCE_CHECKIN_REJECTED` records `{ reason, siteId }` and **no coordinates**. | **Allowed, flagged** `MOCK_LOCATION_AT_CHECKOUT` | A mock location is deliberate. Flagging alone would make GPS-required trivially bypassable. The audit row lets HR see repeated attempts. At check-out the same "don't leave it open" reasoning applies, and the flag shows up in reports. |
| **Stale fix** (`capturedAt` more than 2 min before server time) | Allowed, flagged `STALE_LOCATION` | Same | Phones can hand back a cached fix. We don't reject on this, because the phone's clock may also be wrong. |

Site visits use this same table, with the chosen site in place of the office. A
visit's mock rejection writes the same `ATTENDANCE_CHECKIN_REJECTED` audit row.

Rejections at check-in for `OUTSIDE_SITE_RADIUS` and `LOCATION_REQUIRED`
are **not** audited. They're normal "try again" events; auditing them would
store a location trail of failed attempts. Only mock detection is.

**Honest limits, to tell HR:**
- `mocked` is reported only on Android. iOS has no equivalent signal, so
  iOS can't detect mocks.
- A rooted Android phone can hide mocking.
- So GPS verification is a deterrent and a record, not proof of presence.

### 3.3 Who sees what
| Data | Employee (own) | Manager (team) | HR / Company Admin | Super Admin |
|---|---|---|---|---|
| Times, status, worked/late minutes | ✅ | ✅ | ✅ | ❌ |
| `withinRadius`, distance, accuracy, flags | ✅ | ✅ | ✅ | ❌ |
| Raw latitude/longitude | ✅ | ❌ | ✅ (detail view only, not lists or CSV) | ❌ |

- Managers need "were they at the site?", not a point on a map.
- CSV exports never contain raw coordinates.

### 3.4 What employees are told
- **Before the first location permission prompt**, the app shows a
  one-time disclosure screen. Google Play requires a "prominent disclosure"
  before asking for location, and it's the honest thing to do. It says:
  > **Why we ask for your location**
  > Your company requires location verification when you check in or out
  > at some work sites.
  > - We read your location **once**, only when you tap **Check in** or
  >   **Check out**. We never track you in the background.
  > - We store the position, its accuracy, and how far you were from the
  >   site.
  > - Your manager sees whether you were within the site area and how far
  >   away you were. HR can also see the exact position.
  > - Exact positions are deleted after **{gpsRetentionDays} days**. Whether
  >   you were inside the area is kept with your attendance record.
- "Continue" opens the OS permission dialog; "Not now" goes back and sends nothing.
- It's remembered per phone, like the OS permission, and isn't shown if location is
  already allowed. On a check-out it comes after the "Are you sure?".
- The same text is always available under **Profile → Location & privacy**,
  which also shows the current OS permission state.
- Wording lives in `strings.ts` (it's English-only, like Phase 1).
- There's no company-specific privacy-policy link in Phase 2 (decided,
  Q16). An app-level privacy policy URL will be needed when the app is
  published to Google Play.

### 3.5 Retention
- **Raw coordinates:** erased after `gpsRetentionDays` (default 90, range
  30–365) by the nightly `gps.purge` job. It sets `*Lat`/`*Lng` to NULL on
  attendance records and site visits whose `checkInAt` is older than that.
- **Distance, `withinRadius`, accuracy, flags and times** are kept with the
  attendance record. They are employment records, and how long a company
  must keep them depends on local law, which is the company's decision. In
  Phase 2 they're kept indefinitely.
- **Rejected attempts:** they have no coordinates anywhere, and audit rows
  only hold the reason.
- **Logs:** pino redaction gains `latitude`, `longitude`, `location` and the
  `checkIn`/`checkOut` `Lat`/`Lng` column names, each at the top level and
  one level down, plus `req.body.location`. A test asserts this, like the
  Phase 1 logger test. Redaction is a safety net with a depth limit, so the
  rule stays: don't log a location object at all.

---

## 4. Push notifications

### 4.1 Shape: every in-app notification can also be a push
- `createNotification()` (Phase 1, `apps/api/src/lib/notifications.ts`)
  stays the only way to notify.
- After writing the `notifications` row, in the **same transaction**, it
  looks up the recipient's active `push_devices`.
  - It writes one `push_messages` row (status `PENDING`) per device, unless
    the user turned push off or turned off that category.
  - A rolled-back event therefore never sends a push. This is the
    **outbox pattern**: you record "a message must be sent" in the same
    transaction as the change, and a separate worker does the slow,
    may-fail network call afterwards.
- **Categories** (for opt-out): `LEAVE`, `ATTENDANCE`, `SITES`, `TASKS`,
  `REMINDERS`. The mapping from notification `type` to category lives in
  `packages/shared`.

### 4.2 Device tokens
- After login, and on every app start while logged in, the app:
  1. asks for notification permission (Android 13+ shows a dialog);
  2. calls `Notifications.getExpoPushTokenAsync({ projectId })`;
  3. calls `POST /push-devices { expoPushToken, platform, deviceName }`.
  - It's an upsert by token. It moves the token to this user and company
    if it was someone else's, clears `disabledAt`, and bumps `lastSeenAt`.
- **On logout** the app calls `POST /push-devices/unregister` *before*
  `/auth/logout`. The logout endpoint is frozen and stays untouched.
  - If the app is uninstalled or the call fails, Expo eventually reports
    `DeviceNotRegistered` and the token is disabled (§4.4).
- Sending also skips devices whose user is deactivated or whose company is
  suspended. This is checked at send time.
- Devices not seen for 60 days are disabled by the housekeeping job.

### 4.3 Sending
- The worker's `push.send` task runs every 30 s. It picks up to 100
  `PENDING` rows due now (`FOR UPDATE SKIP LOCKED`, see §5.3) and hands
  them to the SDK.
- Right after a notification is committed, the API also triggers the send,
  fire-and-forget, so pushes usually arrive within a second or two. The
  30 s sweep is the safety net if that fails or the process restarts.
- **Library: Expo's official `expo-server-sdk`** (decided, Q21). It's a
  new `apps/api` dependency, approved for step 2.9b. We use it for:
  - `Expo.isExpoPushToken(token)` to validate tokens in `POST /push-devices`;
  - `expo.chunkPushNotifications(messages)` and
    `expo.sendPushNotificationsAsync(chunk)` to send, which returns one
    ticket per message;
  - `expo.chunkPushNotificationReceiptIds(ids)` and
    `expo.getPushNotificationReceiptsAsync(chunk)` for receipts (§4.4).
  - The SDK knows Expo's batch limits and request format, so we don't
    maintain that ourselves.
- **Behind our own interface.** The SDK sits behind a small `PushSender`
  interface (`apps/api/src/lib/push/`), the same idea as `StorageService`.
  - The worker only talks to `PushSender`.
  - Tests use a fake sender that returns chosen tickets and receipts
    (`ok`, `DeviceNotRegistered`, …), so the test suite never calls Expo's
    servers.
  - The outbox status logic (retries, backoff, disabling devices) is ours
    and is tested through that fake.
- Optional `EXPO_ACCESS_TOKEN` env var, passed as `new Expo({ accessToken })`.
  That's Expo's "enhanced push security"; turn it on once push works.
  - It goes in `.env.example`, empty.
- **Payload:**
  ```json
  { "to": "ExponentPushToken[…]", "title": "...", "body": "...",
    "sound": "default", "channelId": "default",
    "data": { "notificationId": "…", "relatedEntityType": "LeaveRequest", "relatedEntityId": "…" } }
  ```
- **Lock-screen safety:**
  - The push `title` is the notification title.
  - The push `body` is a **short safe text**: it never contains HR notes,
    medical document review details or the leave reason. Example: "Your
    sick leave document was reviewed. Open the app for details."
  - The full body stays in-app.
  - Each notification type has a `pushBody` in shared code.
- **Response tickets:**
  - `ok` → status `SENT`, store `expoTicketId`.
  - error `DeviceNotRegistered` → disable the device, `FAILED`.
  - Other errors or HTTP 5xx/429 → retry with backoff (1 min, 5 min,
    30 min). After 3 attempts the row is `FAILED`.

### 4.4 Receipts
- A ticket only means "Expo accepted it". The **receipt**, available about
  15 min later, says whether Apple/Google delivered it.
- `push.receipts` runs every 15 min. It takes `SENT` rows sent between 15
  min and 24 h ago, and fetches their receipts with
  `getPushNotificationReceiptsAsync`, which the SDK chunks.
  - `ok` → `DELIVERED`.
  - `DeviceNotRegistered` → disable the device (`disabledReason`).
  - `MessageRateExceeded` → back to `PENDING` with backoff.
  - `MismatchSenderId` / `InvalidCredentials` → `FAILED`, plus a pino
    `error` log "push credentials misconfigured". This is a setup problem,
    not a device problem, so the device stays enabled.
  - No receipt after 24 h → delivery is unknown. The row stays `SENT` and
    is purged after 30 days.

### 4.5 Opening a push
- `Notifications.addNotificationResponseReceivedListener` in the root
  layout:
  1. marks the notification read (`PATCH /notifications/:id/read`);
  2. navigates using the shared target helper.
- Phase 1's `getNotificationLeaveRequestId` becomes `getNotificationTarget(n)`,
  which returns `{ kind: "leaveRequest" | "attendance" | "siteVisit" |
  "task", id }`.
- On a cold start it uses `getLastNotificationResponseAsync()`.
- Foreground pushes show as a banner, and the bell's unread-count query is
  invalidated.

### 4.6 Opt-out
- `GET`/`PATCH /notification-settings/me`: `pushEnabled` plus
  `pushDisabledCategories`.
- Mobile: **Profile → Notifications** has a master switch and one switch per
  category. Web shows the same settings for web users, but they only
  affect their phones.
- In-app notifications can't be turned off; they are the record.
- If the OS permission is denied, the screen says so and links to system
  settings.

### 4.7 What you (the developer) must set up for Android push
Push on Android **does not work in Expo Go** (it was removed in SDK 53), so
you need an **Expo development build**. A dev build is your own installable
APK that contains the native code (push, location) and still loads your JS
live from `expo start`, like Expo Go does.

1. **Expo account.** Sign up at expo.dev (free). On your PC: `npx eas-cli
   login`. EAS CLI runs through `npx`, so it isn't a project dependency.
2. **Link the project.** In `apps/mobile`, run `npx eas-cli init`. It
   creates the project on expo.dev and writes
   `expo.extra.eas.projectId` into `app.json`; `getExpoPushTokenAsync`
   needs that id. Commit that change; it isn't secret.
3. **Firebase project** (FCM is how Google delivers pushes):
   - console.firebase.google.com → Add project (Analytics not needed).
   - Add an **Android app** with package name `com.employeesaas.mobile`,
     exactly as in `app.json`.
   - Download **`google-services.json`** and put it in `apps/mobile/`.
   - Set `"android": { "googleServicesFile": "./google-services.json" }` in
     `app.json`.
   - It's **gitignored**. Google says it's safe in an app, but the repo
     doesn't need it. For EAS cloud builds, upload it with `npx eas-cli env:create --name
     GOOGLE_SERVICES_JSON --type file --visibility secret`, and `app.config`
     reads the path from that env var.
4. **FCM V1 credentials for Expo's servers.** This one is a real
   secret:
   - Firebase → Project settings → **Service accounts** → *Generate new
     private key*. This downloads a JSON file.
   - Run `npx eas-cli credentials` → Android → development → **Google
     Service Account** → *Manage your Google Service Account Key for Push
     Notifications (FCM V1)* → upload that JSON.
   - Then delete the downloaded file from your PC, or keep it outside the
     repo. **Never commit it.**
5. **Libraries** (approved, Q23; installed with `npx expo install` so the
   versions match SDK 58, each at its own step). On the API side,
   `expo-server-sdk` is added in 2.9b (Q21).
   - `expo-notifications`
   - `expo-device` (to check "is this a real device?")
   - `expo-dev-client`
   - `expo-location` (for GPS, step 2.4)
6. **`eas.json`** gets a `development` profile with `"developmentClient":
   true, "distribution": "internal"` and Android `"buildType": "apk"`.
7. **Build:**
   - Run `npx eas-cli build --profile development --platform android`.
   - It builds in Expo's cloud. The free tier queues, and a build usually
     takes 10–30 min.
   - When it's done, it prints a link and a QR code.
   - Open the link on your phone, download the APK and install it. You'll
     need to allow "install unknown apps" for your browser.
   - You only need to **rebuild when native things change** (a new native
     library, `app.json` plugins or permissions). JS changes don't need a
     rebuild.
8. **Run:**
   - Run `pnpm --filter @employee-saas/mobile exec expo start --dev-client`.
   - Open the "Employee SaaS" dev build app on the phone (not Expo Go) and
     scan the QR code, or pick the server from the list.
   - The phone must be on the same Wi-Fi, as now.
9. **Test on your phone:**
   1. Log in as Alex and allow notifications. The API log should show
      `POST /push-devices 200`.
   2. Smoke-test the token itself. Copy it from Profile → Notifications
      (dev builds show it under a "debug" row) into
      **expo.dev/notifications** and send a test push. It should arrive.
   3. Real event: put the app in the background. On web, as the manager,
      approve Alex's leave. A push should arrive within seconds, and tapping
      it opens the leave request.
   4. Turn off the **Leave** category, repeat, and check that no push
      arrives but the in-app notification still appears.
   5. Uninstall the app, trigger another notification and wait about 15
      min. The receipt job disables the token. Check `push_devices.disabledAt`.

   **iOS** additionally needs an Apple Developer account ($99/year) and APNs
   credentials. It's out of scope for Phase 2 (decided, Q14).
- **Risk:** EAS builds a **pnpm monorepo**, and our `pnpm-workspace.yaml`
  has custom hoisting rules for React 18/19. EAS may need extra settings to
  install the workspace correctly. That's why step 2.9a is "get a dev build
  running" on its own, before any push code.

---

## 5. The job runner (no new infrastructure)

### 5.1 Decision: a small in-house runner on Postgres (Q20)
| Option | For | Against |
|---|---|---|
| **pg-boss** (a library that uses Postgres as a queue) | Retries, cron, singleton jobs, all battle-tested | A new dependency with its own `pgboss` schema and migrations. Its cron runs in **one** timezone per schedule, so per-company local times still need our own dispatcher on top. |
| **In-house: one `job_runs` claim table + `SKIP LOCKED` for queues** ✅ | No new library. About 200 lines that are easy to read and test with a fake clock. Per-company timezones are first-class. It reuses the outbox we need for push anyway. | We own the retry/backoff code. That's acceptable for 7 jobs. |

**In-house** (accepted, Q20). The hard requirement, "run at 09:00 in
*each company's* timezone", has to be solved by our own code either way.
Once that dispatcher exists, the remaining features pg-boss would add are
small. If Phase 3 needs a general queue (e.g. payslip PDF generation), we
can revisit pg-boss then.

### 5.2 How it runs
- **A separate entry point** `apps/api/src/worker.ts`, from the same
  codebase and same Prisma client, started with `pnpm --filter api worker`.
  - `pnpm dev` starts api + web + worker.
  - In production it's a second process, from the same image, with a
    different command.
  - `JOBS_ENABLED=false` lets an instance skip jobs entirely.
  - Keeping jobs out of the API process means a slow job never slows down
    requests.
- **Ticks:** the worker has a 30 s loop.
  - Each tick runs the **queue tasks** (`push.send`) and the **scheduled
    tasks**.
  - For scheduled tasks, it loads active companies with their timezone and
    settings, and asks each job "is something due for this company now?".
- Each job is a plain module:
  ```ts
  interface Job {
    name: string;                          // "attendance.dayClose"
    module?: "attendance" | "sites" | "tasks";
    everyTick?(context): Promise<void>;    // cheap and idempotent, no claim
    dueRunKeys?(context): Promise<string[]>;  // e.g. ["2026-11-03"] once 09:00 local has passed today
    run?(context, runKey): Promise<void>;  // must be idempotent
  }
  // context = { tenant, company, settings, now }
  ```
- `now` is always passed in, never read from the clock inside a job, so
  Vitest can run "the day at 23:59 in Colombo" deterministically.
- `/health` gains `worker: { lastTickAt, ok }`, so you can see if the worker is down. `ok`
  means the last tick was under 2 minutes ago. Most ticks claim nothing, so every tick
  moves one heartbeat row in `job_runs` (`worker.tick`) instead of adding a row. A worker
  being down doesn't fail the check: the API itself is fine.
- `pnpm --filter @employee-saas/api worker --once` runs one tick and exits.

### 5.3 Safe with two (or more) instances
There are three layers, and each one alone prevents duplicates of its kind:
1. **Claim row per (job, company, runKey).**
   - Before running, the worker does `INSERT INTO job_runs (jobName,
     companyId, runKey, status) VALUES (…, 'RUNNING') ON CONFLICT DO
     NOTHING RETURNING id`.
   - Only one instance gets a row back. The others skip.
   - Afterwards it's set to `DONE` (or `FAILED` with `lastError`).
   - A `RUNNING` row older than 15 min is considered crashed. It can be
     re-claimed with an atomic `UPDATE … WHERE status='RUNNING' AND
     startedAt < now() - interval '15 min' RETURNING id`, up to 3 attempts.
2. **Idempotent work.** Even if a job ran twice, the result is the same:
   - **Day close:** `INSERT … ON CONFLICT (companyId, employeeId, workDate)
     DO NOTHING` for absent rows; `UPDATE … WHERE checkOutAt IS NULL AND
     autoClosedAt IS NULL` for auto-close.
   - **Reminders:** a notification `dedupeKey` with `ON CONFLICT DO NOTHING`.
3. **Row-level queue locking** for `push_messages`: `SELECT … FOR UPDATE
   SKIP LOCKED LIMIT 100` inside a short transaction.
   - Two senders each get *different* rows. That's what `SKIP LOCKED`
     means: "skip rows another transaction has locked, don't wait for them".

**Why not advisory locks?** A session-level advisory lock belongs to one
DB connection. Prisma uses a connection pool, so the "unlock" can run on a
different connection than the "lock" and silently fail. Claim rows behave
like normal rows, which avoids that trap and also leaves a visible history.

Tests:
- Start two `runTick(now)` calls concurrently against the test DB.
- Assert one `job_runs` row, one reminder per employee and one `ABSENT`
  per employee.

### 5.4 The jobs
All times are company-local and computed with `zonedDateTimeToUtc`.
**Catch-up:** if the worker was down, a job handles run keys from the last
48 h (day close) or 2 h (reminders, since a reminder 5 hours late is
useless and is skipped).

| Job | When (company-local) | runKey | What it does | Idempotency |
|---|---|---|---|---|
| `attendance.dayClose` (auto-close + absent marking) | Every tick. Per employee, when `now >= scheduledEndAt(workDate) + autoCheckoutAfterMinutes`. | `workDate`, with the claim taken per company per work date at the **latest** shift end in the company. Employees whose shift ends earlier are handled by a lightweight per-employee pass on each tick (see note). | 1. **Auto-close:** records with check-in and no check-out → `status = INCOMPLETE`, `autoClosedAt = now`, flag `AUTO_CLOSED`; open site visits → `AUTO_CLOSED`; employee gets `ATTENDANCE_AUTO_CLOSED` ("You didn't check out on 3 Nov. Ask HR to correct it."). 2. **Absent marking:** active employees (joined on or before `workDate`) with no record on a working day → `ON_LEAVE` if approved leave covers it, `HOLIDAY` if it's a company holiday, else `ABSENT`. No notification for absent. | `UPDATE … WHERE checkOutAt IS NULL AND autoClosedAt IS NULL`; `INSERT … ON CONFLICT DO NOTHING`; notification `dedupeKey = AUTO_CLOSED:<recordId>` |
| `attendance.checkinReminder` | Per employee at `scheduledStartAt + checkinReminderOffsetMinutes`, if `checkinReminderEnabled` | dedupeKey only (per employee per day) | → employee "You haven't checked in yet today". Skip if: non-working day, holiday, full-day approved leave, already checked in (office or site), no active login, inactive. | `dedupeKey = CHECKIN_REMINDER:<employeeId>:<workDate>` |
| `leave.proofDueTomorrow` | Daily at `dailyReminderTime` | `localDate` | Requests with `proofStatus IN (MISSING, INFO_REQUIRED, REJECTED)`, status not `CANCELLED/REJECTED/REVOKED`, and proof due date (`proofDueAt` is a UTC-midnight calendar date in Phase 1) **= tomorrow** → employee "Sick leave proof due tomorrow". | `dedupeKey = PROOF_DUE_TOMORROW:<leaveRequestId>` (once per request) |
| `leave.proofOverdue` | Daily at `dailyReminderTime` | `localDate` | Same filter, due date **< today** → every active HR user, except the requester (Phase 1 rule). One notification per request, sent once, not daily. | `dedupeKey = PROOF_OVERDUE:<leaveRequestId>:<hrUserId>` |
| `gps.purge` | Daily 03:00 | `localDate` | NULL the coordinates older than `gpsRetentionDays`. | Pure `UPDATE … WHERE … IS NOT NULL` |
| `push.send` | Every tick (queue) | none | §4.3 | `SKIP LOCKED` + status transitions |
| `push.receipts` | Every 15 min (platform-wide) | `yyyy-mm-ddThh:mm` rounded to 15 | §4.4 | claim row |
| `housekeeping` | Daily 04:00 UTC (platform-wide) | UTC date | Purge `job_runs` and `push_messages` older than 30 days; disable devices not seen for 60 days. | claim row |

**Note on day close.** Different employees end at different times (night
shifts, overrides), so a single run per company per day isn't enough. The
pass is cheap and idempotent:
- On every tick it handles `(employee, workDate)` pairs whose close time
  has passed, filtered by the partial index on open records, plus a
  "no record yet" query.
- The `job_runs` claim per company per workDate marks the date as
  **finished** once every employee's close time has passed, so later ticks
  stop scanning it.

**Details settled in step 2.7** (`apps/api/src/modules/attendance/dayClose.job.ts`):
- **Three separate passes.** Forgotten records, by each record's close time and whatever its
  date, every tick. No-shows, per date, per employee. Forgotten visits, every tick. The first
  two are under the `attendance` module, the third under `sites`.
- **The schedule** comes from `resolveEffectiveSchedule` with the override applied, the same as a
  check-in, so an override's night shift or half day closes when that shift does. The company's
  and each override's hours decide when a date is finished.
- **Precedence:** a holiday beats leave, as in §1.2, since a leave doesn't spend a day on a
  holiday. Half-day leave counts as `ON_LEAVE` with `HALF_DAY_LEAVE` (Q8).
- **A holiday on a weekly off day writes no row:** it's still an off day (§1.4).
- **`HOLIDAY` rows are written at local midnight,** when the date has moved on, and not at a
  close time. A holiday has no shift end, and anyone may check in during it (§1.5). A row earlier
  would refuse them (§1.3).
- **A no-show only counts if attendance was on when that day started**
  (`company_settings.attendanceEnabledAt`, set when the module is switched on). Without this, the
  catch-up would mark everyone `ABSENT` for days when nobody could check in. If it's null, nothing
  is marked. Auto-close doesn't check it, since a record is real whenever it was made.
- **A forgotten visit** closes 16 hours after its check-in, like a check-in with no schedule, and the
  employee gets `SITE_VISIT_AUTO_CLOSED`. It keeps no check-out, as `AUTO_CLOSED` means.
- **Closing a record closes only the visits linked to it.** After a worker outage, closing yesterday's
  record mustn't end the visit someone is on today. With `sites` off, a linked visit still closes,
  since nothing else could close it.
- **Hooks decide from the facts.** After a leave or holiday changes, each no-check-in row in the range
  is set from today's holidays and approved leave, rather than flipped one way, so it's safe to
  repeat. A row with a check-in keeps its times and status. It only gains or loses `ON_APPROVED_LEAVE`
  or `HALF_DAY_LEAVE`, unless it's on a day off. A row becoming `HOLIDAY` loses its schedule snapshot,
  so a later HR correction isn't judged against a shift that wasn't on. Hooks ignore the module
  switch: past rows should be right either way.
- **Deactivation** closes every open record and visit at once with the same code, sends no notification
  (the login is being deactivated too, and "ask HR" wouldn't make sense), and records the counts in
  the `EMPLOYEE_DEACTIVATED` audit row.

**Proof reminders and HR's notes.** The Phase 1 flow for `INFO_REQUIRED`
keeps the same `proofDueAt`: "info required" doesn't give a fresh
deadline (decided, Q19).

### 5.5 Failure handling
- A job that throws is marked `FAILED` with a **sanitised** `lastError`
  (error code and message only, never row data) and retried on the next
  tick, up to 3 attempts.
- After that it's logged at `error` and left for a human.
- One company's failure never stops another company's jobs, because each
  (company, job) is its own try/catch.

---

## 6. Reports
- **Daily attendance** for one date: every active employee in scope, with
  status, check-in/out, worked minutes, late minutes, flags and site.
  - For **today**, employees with no row yet show a display-only state:
    `NOT_CHECKED_IN` before the close time, `ON_LEAVE`/`HOLIDAY` from
    leave/holidays. It's computed on read and not stored.
  - An `ABSENT` row with an `ON_ABSENT_DAY` visit (§1.6) carries that flag in
    `siteVisitFlags`, in the page and the CSV, so HR can spot it and correct
    the row.
- **Monthly summary** per employee for `YYYY-MM` in company time: present
  (incl. late and incomplete), late, absent, on leave, holiday, incomplete
  days, and total worked minutes.
  - Built by one `GROUP BY` over `attendance_records` for that month's
    date range.
- **Site visit history:** filter by date range (max 93 days), site,
  employee and flag. It shows duration and flags, including `AFTER_HOURS` and
  `ON_ABSENT_DAY` (§1.6), which also appear in the CSV.
- **CSV export** for each of these:
  - UTF-8 with BOM, so Excel opens Sinhala/Tamil names correctly.
  - Times are in company local time, with the timezone in the header row.
  - Generated synchronously and capped at 10,000 rows (the date-range limit
    keeps it below that).
  - **CSV formula-injection guard:** any cell starting with `=`, `+`, `-`,
    `@`, tab or CR gets a leading `'`. An employee named `=HYPERLINK(...)`
    would otherwise run as a formula in Excel. It's a small, real attack.
  - No raw coordinates.
- **Scope:**
  - managers see their direct reports only;
  - HR and Company Admin see the whole company;
  - employees see only their own records via `/attendance/me` (no report
    endpoints).
- Exports are logged in `audit_logs` (`REPORT_EXPORTED`, with the filters
  used), since they move personal data out of the system.
- Excel/PDF come in Phase 3.

---

## 7. Staying compatible with the central identity migration
The future platform will replace HR login with a central identity service,
so one person may have one account across companies.

Phase 2 is designed so that migration only has to touch a few known places:
1. **No changes to `users`, `companies`, `refresh_tokens`, login, refresh,
   logout or token contents.**
   - New endpoints read only `req.auth.userId`, `companyId` and `role`, plus
     the employee lookup that already exists.
   - Logout cleanup for push is a separate client call (§4.2), not a change
     to `/auth/logout`.
2. **Work data hangs off `employees.id`**: attendance, visits, schedules,
   task assignees. An employee is a company's HR record, and that stays
   true whatever happens to logins.
3. **`users.id` appears only where it's about a login**:
   - `push_devices.userId`;
   - `user_notification_settings.userId`;
   - the actor columns `createdByUserId` and `correctedByUserId`;
   - the existing `notifications.userId`.

   At migration time these become "account/membership id" columns via one
   mapping table. The full list is right here, so nothing is forgotten.
4. **Recipients are resolved at send time** through one function,
   `findLoginUserIdForEmployee(employeeId)`, already used in spirit by
   Phase 1's `findCurrentApproverUserIds`. They're never cached in job
   tables. If logins move to a central service, only that lookup changes.
5. **`push_devices` keeps `companyId`**, and register/unregister act on
   (token, company). When one central account can switch between companies
   on the same phone, the token moves with the active company. The phone
   then never gets company A's pushes while logged into company B, which
   matters even more once one account spans companies.
6. **Jobs never authenticate.** They work through
   `getTenantPrisma(companyId)` per company, so they don't care how humans
   log in.

---

## 8. New concepts in this phase (plain-language)
- **Outbox pattern:** record "send this later" in the same DB transaction as
  the change; a worker sends it. You never get "notified about something
  that was rolled back", and you never lose a message because the network
  failed at the wrong moment.
- **`FOR UPDATE SKIP LOCKED`:** lets several workers take jobs from the
  same table without picking the same row.
- **Idempotent job:** running it twice gives the same result as once. That
  makes retries and two servers safe.
- **Haversine:** the formula for the distance between two
  latitude/longitude points on a sphere (the Earth). It's accurate to well
  under 1% at these distances.
- **Development build:** your own build of the Expo app, with the native
  modules you chose. You install it once, and it loads your JS from the
  dev server like Expo Go.
