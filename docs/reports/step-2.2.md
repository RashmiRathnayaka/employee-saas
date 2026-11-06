# Step 2.2 Report — Sites

Plan: `docs/phase2/plan.md` → 2.2. Checklist: `docs/reports/step-2.2-progress.md`.

**Status: code complete. Typecheck, lint and all 652 tests pass. I also ran the
page in a real browser against the test database, but your own checklist below
is still to do.**

## Your two decisions
- **Site check-in on a day already marked `ABSENT`:** the row is left alone, the
  visit is flagged `ON_ABSENT_DAY`, and the HR daily report shows it so HR can
  correct it. This is written into the docs; the code comes in 2.5 (the flag),
  2.6 (daily view) and 2.11 (report and CSV).
  - **My reading of it, please check:** `ON_ABSENT_DAY` replaces `AFTER_HOURS`
    on an `ABSENT` day. Days marked `ON_LEAVE` or `HOLIDAY` stay `AFTER_HOURS`,
    because you only mentioned `ABSENT`.
  - The daily report shows the flag only while the row is still `ABSENT`, so it
    disappears once HR corrects the row or approved leave flips it.
- **1–16 hour rule on the company default hours:** done (see below).

## What was done

### Shared (`packages/shared`)
- **`sites.ts`** (new): request, response and list schemas, and
  `getSiteLocationErrors`, the rule for coordinates and "GPS required".
- **`gpsRadiusMeters`** now has the same 25–5000 range as a site's radius. It
  used to accept 0.
- **`isValidShiftLength`:** the 1–16 hour rule, including across midnight.
  09:00–09:00 counts as 24 hours, so it's rejected. Step 2.6's per-employee
  overrides can reuse it.

### Database (`20261106120000_phase2_sites`)
- The `sites` table and the `SiteType` enum.
- Hand-written: a unique index on `(companyId, lower(name))` and 6 CHECKs: radius
  range, latitude range, longitude range, coordinates set together, GPS-required
  needs coordinates, and the `company_settings.gpsRadiusMeters` range.
- **Freeze check:** no `ALTER TABLE` on `companies`, `users` or `refresh_tokens`.
- **Back-relation lines added (no SQL):** `Company.sites` and `User.createdSites`.

### API
- **Six endpoints**, all behind `requireModule("sites")`, the first real gated
  router: list, read, create, edit, status, delete.
- **Employees and managers** get active sites only, and never coordinates. The
  response is built from a separate, smaller shape, so a position can't slip in.
- **Audit entries:** `SITE_CREATED`, `SITE_UPDATED` (before and after of changed
  fields only), `SITE_STATUS_CHANGED`, `SITE_DELETED`.
- **Settings:** a PATCH that sends only the start or only the end is checked
  against the stored other end. The error lands on the field that was sent.

### Web
- **Sites page** (HR and Company Admin): list, search, type and status filters,
  create/edit form, deactivate, activate, delete.
- **Map link:** appears in the form as soon as both coordinates are valid, and on
  each row.
- **New sites** start from the company's default radius and GPS setting.
- **Menu:** the Sites item only shows while the module is on, and switching it
  off removes the item without a reload. Opening `/sites` directly with the
  module off shows an explanation rather than an error.
- **Settings page:** the two missing fields, default radius and "Require GPS at
  new sites by default".

### Docs
- `ON_ABSENT_DAY`, the shift rule and the Sites details in the plan, architecture,
  schema and API docs.
- A "UX improvements backlog" section in the plan, with the proof image preview.

## Changes beyond the literal plan
| Change | Why |
|---|---|
| **CHECK: latitude and longitude set together** | The schema doc didn't list it, but half a position is useless. Now documented. |
| **CHECK on `company_settings.gpsRadiusMeters`** | You asked for the validation fix. This also guards the database, like the other settings ranges. All rows were 200, so it applied cleanly. |
| **An inactive site's name stays taken** | The index covers every row, as designed. Now spelled out in the docs. |
| **A save that changes nothing writes no audit row** | The form sends every field, so otherwise each Save would log noise. |
| **`SITE_NAME_TAKEN` error code** | The API doc had no code for this case. |
| **`diffFields` moved to `lib/auditDiff.ts`** | Settings and Sites both need it. Behaviour is unchanged. |
| **`GET /sites` returns offices to employees too** | The API doc says "active sites", while architecture §2 says the picker shows `EXTERNAL` ones. They agree if the 2.5 picker asks for `?type=EXTERNAL`, which is now written down. |

## Not in this step, on purpose
- **`fromMyTasks`** in `GET /sites`: there are no tasks until step 2.10. The docs
  now say it arrives then.
- **Mobile:** no site screens until step 2.5.

## New concepts (plain language)
- **Two response shapes for one table:** HR gets `SiteDto` and employees get
  `SiteSummaryDto`. Building each response from a fixed list of fields is safer
  than removing fields from the full row, where a column added later would leak
  by default.
- **Letting the database decide "in use":** instead of counting references in
  every table, delete just tries. Later tables will reference sites with `ON
  DELETE RESTRICT`, so Postgres refuses, and we turn that into `409 SITE_IN_USE`.
  Steps 2.3, 2.5 and 2.10 can't forget to extend a check, because there isn't one.
- **Validating across fields:** "GPS required needs coordinates" can only be judged
  on the final values, after merging a partial edit or company defaults. So it runs
  on the server, and the form shows the result on the field.

## Problems found while running it
Unit tests didn't catch these two. I found them by looking at screenshots.
- **Stale location error (fixed, now tested).** Fixing one field could leave the
  error showing on another, because the form only re-checks the field being edited.
- **Wrong search placeholder (fixed).** It said "Search by name or code", copied
  from Employees.

I also gave the dialog a maximum height so Save can't fall off a short screen.

## Files changed
**Shared**
- `packages/shared/src/company.ts`, `index.ts`, `company.test.ts`
- New: `sites.ts`, `sites.test.ts`

**API**
- `apps/api/prisma/schema.prisma`
- New: `apps/api/prisma/migrations/20261106120000_phase2_sites/migration.sql`
- `apps/api/src/app.ts`, `lib/prismaErrors.ts`, `lib/tenantPrisma.ts`,
  `modules/company/company.service.ts`, `modules/company/company.test.ts`,
  `middleware/requireModule.test.ts` (comment only)
- New: `src/lib/auditDiff.ts`, `src/modules/sites/sites.routes.ts`,
  `sites.service.ts`, `sites.test.ts`

**Web**
- `apps/web/src/App.tsx`, `strings.ts`, `layout/AppShell.tsx`,
  `lib/navigation.ts`, `lib/queries.ts`, `routes/CompanySettingsPage.tsx`,
  `routes/CompanySettingsPage.test.tsx`
- New: `src/routes/SitesPage.tsx`, `routes/SitesPage.test.tsx`,
  `lib/navigation.test.ts`

**Docs**
- `docs/phase2/plan.md`, `architecture-phase2.md`, `database-schema-phase2.md`,
  `api-phase2.md`
- New: `docs/reports/step-2.2.md`, `step-2.2-progress.md`

## Commands run
```
prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script
prisma generate                  FAILED on a file lock (see Known limitations)
prisma migrate deploy            test DB, then dev DB
tsx prisma/seed.ts               test DB only, for the browser check
pnpm typecheck                   exit 0
pnpm lint                        exit 0
pnpm test                        exit 0, 181 s
```

## Test results
| Workspace | Before (step 2.1) | Now |
|---|---|---|
| shared | 208 | 237 |
| api | 231 | 318 |
| mobile | 29 | 29 |
| web | 33 | 68 |
| **Total** | **501** | **652** |

**Real browser:** 28 checks in headless Chromium, using a throwaway script against
a temporary API on the **test** database. They covered the form, errors, filters,
deactivating, Alex's view and BETA with the module off, plus the settings errors
and defaults. All passed, with no browser console errors. The script isn't in the
repo. It checked the map link's address but didn't open Google Maps.

## Dev database check
Row counts of every table, and both companies' settings, before the migration and
after the full test run:

| Table | Before | After | Why |
|---|---|---|---|
| `_prisma_migrations` | 7 | 8 | This step's migration |
| `sites` | none | 0 | New table, empty |
| `refresh_tokens` | 39 | 40 | **Not from this work:** your `hr@acme.test` browser session refreshed its login at 10:21. The old token shows as replaced. |
| The other 14 tables | same | same | |

`enabledModules`, `gpsRadiusMeters` and the working hours are unchanged for both
companies. No reset and no reseed.

## Your checklist
**First stop and restart `pnpm dev`** (see "Known limitations" for the extra
command to run while it's stopped).

**Web, as your ACME HR or Company Admin:**
1. **Sites** is in the menu. It's empty, with a "New site" button.
2. Create your real office: type Office, coordinates copied from Google Maps,
   radius 200, "Require GPS at check-in" ticked. Before saving, click the map
   link and check it's the right place.
3. Create one External site near your home.
4. Try the name of your office again in capitals: "already exists" on the name
   field.
5. Tick GPS on a site with no coordinates and save: the error appears under
   Latitude, then goes away when you fill it in.
6. Try the search and both filters.
7. Deactivate one site: it stays in your list as Inactive.
8. Check Alex no longer gets it, in PowerShell (it asks for Alex's password):
   ```
   $p = Read-Host "Alex's password"
   $login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/v1/auth/login -Headers @{ "X-Client" = "mobile" } -ContentType "application/json" -Body (@{ companyCode = "ACME"; identifier = "alex@acme.test"; password = $p } | ConvertTo-Json)
   (Invoke-RestMethod -Uri http://localhost:4000/api/v1/sites -Headers @{ Authorization = "Bearer $($login.accessToken)" }).data
   ```
   You should see only active sites, with `hasCoordinates` and no latitude or
   longitude.
9. Activate it again. Delete one you don't need.

**Settings, as Company Admin:**
10. In "Attendance, reminders and location", set the end time equal to the start
    time and Save: "A shift must be between 1 and 16 hours long" appears.
11. Try 22:00–06:00: it saves. Put your real hours back afterwards.
12. Set the default radius to 0: "Must be between 25 and 5000". Set it to 300 and
    Save: a new site's form starts at 300.
13. Untick Sites under Modules and Save: the menu item disappears straight away.
    Tick it again.

**Isolation:**
14. Log in as BETA's HR: no Sites item. Opening `/sites` says the feature is off.

**Audit log:**
15. In PowerShell:
    ```
    docker exec employee-saas-postgres-1 psql -U employee_saas -d employee_saas -c "SELECT action, metadata FROM audit_logs WHERE \"entityType\" = 'Site' ORDER BY \"createdAt\";"
    ```

## Known limitations
- **`prisma generate` couldn't finish.** Your running `pnpm dev` holds the Prisma
  engine file open, and I didn't stop your server. The generated client code did
  update, and all the tests ran against it. Only the engine binary (which hasn't
  changed) and a schema copy weren't refreshed. To finish it cleanly, while
  `pnpm dev` is stopped, run `pnpm --filter @employee-saas/api db:generate`.
- **`SITE_IN_USE` is tested with a stand-in table**, because no real table
  references sites until step 2.3. It has the same kind of foreign key those
  tables will have.
- **A stored shift that already breaks the rule stays until someone edits it.**
  An unrelated save isn't blocked; the attendance card sends both times, so saving
  that card makes you fix it. Both dev companies are within the rule.
- **Search treats `%` and `_` as wildcards**, so searching `100%` can match more
  than expected. It's harmless, and the employee search does the same.

## Noticed, not changed
- **Google Maps copies both numbers at once** ("6.927079, 79.861244"). Pasted into
  Latitude, that's rejected, so you need to split it by hand. Filling both boxes
  from one paste would be a small improvement. It isn't in the plan, so I didn't
  add it.
- **Company profile colour:** with no colour set, the picker shows black. Pressing
  that card's Save probably stores black as the brand colour. It's Phase 1 code,
  and I saw the swatch but didn't test saving.

## Exact next step
Run the checklist above, and confirm my reading of `ON_ABSENT_DAY`. After that,
**step 2.3 Office attendance**: `attendance_records`, check-in and check-out with
the status and work-date rules, and the mobile Attendance card and tab. That step
also resolves the night-shift check-out gap noted in `step-2.1.md`, and you can
start the Expo and Firebase accounts during it.
