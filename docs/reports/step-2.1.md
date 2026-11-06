# Step 2.1 Report — Foundations

Plan: `docs/phase2/plan.md` → 2.1. Checklist: `docs/reports/step-2.1-progress.md`.

**Status: code complete, and typecheck, lint and all tests pass. The page has
not been opened in a real browser or on a phone yet.** That's your checklist
below.

## Your two decisions
- **Site check-in after the day is closed:** it records the visit, doesn't
  reopen the day, and flags the visit `AFTER_HOURS`, which shows in the
  site-visit report and CSV. This is written into the docs; the code itself
  comes in step 2.5.
- **No reseed of the dev database.** I checked this: row counts in 9 tables
  and both companies' `enabledModules` are identical before and after the
  whole step, including after the full test run. ACME's modules are still
  off, ready for you to switch on.

The dev database **did** get the new migration, as the plan says. It only adds
columns with defaults, CHECK constraints and one index, and it doesn't change
any existing value.

## What was done

### Shared (`packages/shared`)
- **`isModuleEnabled(settings, module)`**: only a literal `true` counts.
  Missing or malformed means off.
- **Settings schemas**: the 11 new fields with their ranges, plus a response
  schema (`CompanySettingsSchema`) that replaces the web page's private type.
- **`zonedDateTimeToUtc`**: `"2026-11-03"` + `"09:00"` in a timezone → the exact
  instant. It uses only `Intl`, with no new library.
- **`getShiftInstants`**: a shift's start and end instants, with an end at or
  before the start meaning the next day. The plan didn't list this helper
  separately; `getWorkDate` needs it, and so will the schedule code in 2.3.
- **`getWorkDate`**: the night-shift rule from architecture §1.3.
- **`haversineMeters`**: the distance between two GPS points.
- **`getNotificationTarget`**: replaces `getNotificationLeaveRequestId`, which
  is now gone. Web and mobile still only act on leave requests, so behaviour
  is unchanged.

### Database (`20261106090000_phase2_foundations`)
- 11 new `company_settings` columns, with 9 hand-written CHECK constraints.
- `notifications.dedupeKey`, with a partial unique index on
  `(companyId, dedupeKey)`.
- **Freeze check:** no `ALTER TABLE` on `companies`, `users` or
  `refresh_tokens`.
- **Back-relation lines added to `Company`/`User`: none.** This step adds no
  new tables.

### API
- **`requireModule()`**: 403 `MODULE_DISABLED`, with a 30 s cache. No router
  uses it yet; Sites will be the first, in 2.2.
- **`PATCH /company/settings`**: accepts the new fields.
- **Pino redaction**: covers latitude, longitude, location and the
  `checkIn`/`checkOut` Lat/Lng columns.

### Seed
ACME gets all three modules on and BETA gets none, when the settings row is
first created. I ran it against the test DB only.

### Web: Company Admin → Settings
Two new cards, each with its own Save button:
- **Modules**: attendance, sites, tasks.
- **Attendance, reminders and location**: working hours, half-day end, grace,
  auto-checkout, both reminder switches, reminder offset, daily reminder time,
  GPS accuracy and retention.

Bad values now show an error next to the field. Both cards say that these
settings have no visible effect until the features ship, so nothing looks
finished before it is.

## Changes beyond the literal plan
| Change | Why |
|---|---|
| **Audit now stores before and after** for the fields that changed | The API doc required it, but the Phase 1 code stored only the request body. New rows have a different `metadata` shape; old rows keep theirs. Nothing reads this field yet. |
| **`enabledModules` is merged, and unknown keys are rejected** | It used to replace the whole object, so `{ attendance: true }` would have turned the other two off. |
| **The seed sets modules on first creation only**, where the plan implied any seed run | Same as every other upsert in the seed. A later seed run can't overwrite your choices, which fits your no-reseed decision. The docs are updated. |
| **Clock-change rules for `zonedDateTimeToUtc`** | The design didn't say. A time that doesn't exist moves forward by the jump; a time that happens twice means the first one. In architecture §1.2. |
| **More redaction paths than the doc listed** | The column names and one nested level. In architecture §3.5. |
| **A `ResizeObserver` stub in the web test setup** | The test environment doesn't have it and the checkbox needs it. It's test-only. |

## New concepts (plain language)
- **Middleware gate:** a check that runs before a route's own code.
  `requireModule("sites")` will sit in front of the whole Sites router, so no
  Sites code runs at all when the module is off.
- **In-process cache:** a value remembered in the API's memory so it doesn't
  query the database on every request. "30 s" is the longest it can be out of
  date. With two API servers, the one that saved the change updates at once,
  and the other catches up within 30 s.
- **Partial unique index:** a uniqueness rule that only applies to some rows.
  Here it covers rows that have a `dedupeKey`, so ordinary notifications, which
  have none, are unaffected.
- **Daylight saving gap and overlap:** on the day clocks go forward, some
  wall-clock times never happen. On the day they go back, some happen twice.
  Colombo has neither, but companies in other timezones can.

## Files changed
**Shared**
- `packages/shared/src/company.ts`, `dates.ts`, `geo.ts` (new), `index.ts`,
  `notifications.ts`
- Tests: `company.test.ts` (new), `geo.test.ts` (new), `zonedTime.test.ts`
  (new), `notifications.test.ts`

**API**
- `apps/api/prisma/schema.prisma`, `prisma/seed.ts`
- `apps/api/prisma/migrations/20261106090000_phase2_foundations/migration.sql`
  (new)
- `apps/api/src/lib/enabledModules.ts` (new), `lib/logger.ts`
- `apps/api/src/middleware/requireModule.ts` (new)
- `apps/api/src/modules/company/company.service.ts`
- Tests: `middleware/requireModule.test.ts` (new),
  `lib/notificationDedupe.test.ts` (new), `lib/logger.test.ts`,
  `modules/company/company.test.ts`

**Web and mobile**
- `apps/web/src/routes/CompanySettingsPage.tsx`, `strings.ts`,
  `lib/useOpenNotification.ts`, `test/setup.ts`
- `apps/web/src/routes/CompanySettingsPage.test.tsx` (new)
- `apps/mobile/src/app/notifications.tsx`

**Docs**
- `docs/phase2/plan.md`, `architecture-phase2.md`,
  `database-schema-phase2.md`, `api-phase2.md`
- `docs/reports/step-2.1.md`, `step-2.1-progress.md` (new)

## Commands run
```
prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script
prisma generate
prisma migrate deploy                     (test DB, then dev DB)
tsx prisma/seed.ts                        (test DB only, twice)
pnpm typecheck                            exit 0
pnpm lint                                 exit 0 (packages/shared has no lint configured)
pnpm test                                 exit 0, 141 s
```

## Test results
| Workspace | Before (step 2.0) | Now |
|---|---|---|
| shared | 28 | 208 |
| api | 180 | 231 |
| mobile | 29 | 29 |
| web | 26 | 33 |
| **Total** | **263** | **501** |

Most new shared tests are table rows that run three times, under
`TZ=Asia/Colombo`, `UTC` and `Europe/London`. They include night shifts and
both 2026 London clock changes.

Also checked by hand:
- The dev DB has the index and the 9 CHECK constraints.
- On the test DB, the seed gave ACME all three modules and BETA none. A second
  run left an admin's change in place.

## Your checklist
**First restart `pnpm dev`:** the Prisma client was regenerated, and an old API
process won't know the new columns.

**Web, as your ACME Company Admin, under Settings:**
1. Modules are all off. Tick Attendance, Sites and Tasks, Save, reload: still
   ticked.
2. Change the start time to 08:30 and grace to 15, Save, reload: both persist.
3. Set retention to 10 and Save: "Must be between 30 and 365" appears next to
   the field, and nothing saves.
4. Check that the two new cards look right. **I haven't seen them rendered.**
5. **Check the audit log.** There's no audit screen or endpoint in the app yet,
   so use this in PowerShell:
   ```
   docker exec employee-saas-postgres-1 psql -U employee_saas -d employee_saas -c "SELECT action, metadata FROM audit_logs WHERE action = 'COMPANY_SETTINGS_UPDATED';"
   ```
   You should see `before` and `after` with only the fields you changed.

**Existing notifications:**
6. Web: open the bell, click a leave notification, and the leave request opens.
7. Phone (Alex): the same from the notifications screen.

**Isolation:**
8. Log in as BETA's admin: its modules are still off and its hours are still
   the defaults.

## Known limitations
- **Nothing is gated yet.** `requireModule` is tested on a small test router
  with the real auth and error handler. Real `MODULE_DISABLED` tests start with
  the Sites router in 2.2.
- **The middleware's database-failure path isn't tested**: if the settings
  lookup fails, the request gets a 500 rather than passing through. It's a short
  `try/catch` that I read through but didn't run.
- **Two admins saving module switches at the same moment** could lose one
  change. The form sends all three switches anyway, so last save wins. That's
  acceptable for a setting this rare.
- **`getNotificationTarget`** returns attendance, site visit and task targets,
  but no notifications of those kinds exist yet, and the apps ignore them until
  those screens ship.

## Questions for you
1. **Closed-day meaning (please confirm).** I treated a day that day close
   already marked `ABSENT`, `ON_LEAVE` or `HOLIDAY` as "closed". A later site
   check-in is recorded as `AFTER_HOURS` and the row stays as it is, until HR
   corrects it. The alternative is that the check-in turns the row into a real
   attendance day. That would suit someone who really did work late, but it
   means a system-written row gets changed automatically. It needs settling
   before 2.5.
2. **Company default shift length.** The 1–16 hour rule is documented for
   per-employee overrides, not for company defaults, and I followed the docs. So
   a default of 09:00–09:00 saves as a 24-hour shift. I recommend applying the
   same 1–16 hour rule to the defaults. Should I add it in 2.2?

## Design gaps found for later steps
- **Step 2.3: night-shift check-out.** The §1.3 rule answers "which shift is
  this check-in for?". Someone on 22:00–06:00 who checks out at 06:30 gets
  today's date from it, so looking up "today's record" would wrongly answer
  `NOT_CHECKED_IN`. In 2.3, check-out should find the employee's open record
  rather than computing a date. The same fix covers a day-shift worker
  staying past midnight. There's a warning in the `getWorkDate` comment, and
  I'll update §1.5 when 2.3 starts.
- **Step 2.2: site defaults.**
  - `gpsRadiusMeters` currently accepts 0, but a site's radius must be 25–5000,
    so a bad default would fail when creating a site.
  - There's no settings field yet for `gpsRadiusMeters` or
    `gpsCheckinEnabledDefault`. Both belong with the Sites work.

## Exact next step
Run the checklist above, including switching ACME's modules on. After that,
**step 2.2 Sites**: the `sites` table, CRUD endpoints with audit entries, the
web Sites page, and the first real `requireModule` router.
