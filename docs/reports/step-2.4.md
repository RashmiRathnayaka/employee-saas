# Step 2.4 Report: GPS verification + privacy disclosure

Plan: `docs/phase2/plan.md` → 2.4. Checklist: `docs/reports/step-2.4-progress.md`.

**Status: code complete. Typecheck and lint pass, and all 1040 tests pass. The API ran
against the test database. The mobile screens have only run in tests, with a fake GPS
and a fake server, and not on a phone. That's your checklist below.**

## Your requests
- **Refusing a check-in after the day has closed:** kept, and recorded as confirmed in
  architecture §1.3.
- **"Are you sure you want to check out?":** added, with tests. Cancelling sends nothing.
  It comes before anything else on that tap, including the location disclosure.
- **"Late by 302 min":** now "Late by 5h 2m", on the Home chip and in the Attendance tab.
  **This also changes short delays: 12 minutes now reads "Late by 12m", not "12 min"**,
  because that's what `formatDuration` gives. If you prefer "12 min" under an hour, it's a
  one-line change.
- **Home "Pending requests":** the empty message now uses normal secondary text. A real
  count stays big.

**Order of work:** you asked for the confirmation first, and I started the API GPS code
before it, then went back. So the work wasn't done in the order you asked. The suggested
commits still put the confirmation first.

## What was done

### Shared
- `LocationSchema` on the check-in and check-out bodies. It has limits, so a huge accuracy
  can't overflow the database column.
- `gpsRequired` and `officeSite` on the today response.
- `formatDistance`: "850 m", "12.3 km".

### API
- **`lib/gpsVerification.ts`:** the §3.2 table as pure functions, ready for site visits in
  2.5, plus nearest-office selection.
- **Check-in:** `LOCATION_REQUIRED`, `OUTSIDE_SITE_RADIUS` and `MOCK_LOCATION_DETECTED`
  rejections, the `LOW_ACCURACY` and `STALE_LOCATION` flags, `checkInSiteId` and
  `NO_OFFICE_SITE`.
- **Mock rejection:** writes an `ATTENDANCE_CHECKIN_REJECTED` audit row with the reason and
  site, and no coordinates. The other two rejections aren't audited, as designed.
- **Check-out:** never rejected for GPS. Problems only add flags.
- **Discarding:** a location sent when no check applies never reaches a column (Q6).

**No migration.** The GPS columns already existed from 2.3.

### Mobile
- `expo-location`, installed with `npx expo install`. It reads one fix, on a tap, in the
  foreground, with a 15-second limit and then the last known fix.
- **Disclosure** before the first permission prompt, with the wording from §3.4 and your
  company's retention days. "Not now" sends nothing.
- **Profile → Location & privacy:** the same text, the current permission, and a settings
  link. It rereads the permission when you come back from settings.
- **Messages:** "You are 12.3 km from ACME Head Office." A refusal for no location also
  offers Open settings.

## Decisions the design didn't cover
Please check these. All are in architecture §2 and §3.1, and all are easy to change now.

| Situation | What I did | Why |
|---|---|---|
| **`/today` must name the "nearest" office, but has no location** | `gpsRequired` = any active office requires GPS. `officeSite` = the only office, or null if there are several. | The location is only read on a tap (§3.1), so the plan's wording couldn't work with several offices. |
| **`sites` module off, attendance on** | Treated as no office: no GPS, flag `NO_OFFICE_SITE`. | An admin can't see or edit sites then, so a leftover GPS office would lock people out with no fix. |
| **Several offices, some GPS, tap with no location** | Refused with `LOCATION_REQUIRED`. | Otherwise, turning location off would skip the check. |
| **Mock location next to an office that doesn't check** | Compared only with offices that require GPS, so it's rejected. | Otherwise a fake position could choose the unchecked office. |
| **Several offices, none requiring GPS** | `checkInSiteId` is NULL. | With no location kept, the nearest is unknown, and picking one would be a guess. |
| **Which office a check-out is compared with** | The one the check-in used, and only if it requires GPS now. | Someone may walk past another branch on the way out. A day started with no office isn't suddenly checked at the end. |
| **Rounding** | Decisions use the same whole metres that are stored. | A row always explains itself: 201 m against 200 m is outside. |
| **State errors vs GPS errors** | "Already checked in" comes first. | Being told you're too far would be misleading when you've already checked in. |
| **Distance before tapping** | Not shown. The server's refusal gives it. | §3.1 suggested it, but employees aren't given site coordinates (`permissions-phase2.md`). |

## New concepts (plain language)
- **Prominent disclosure:** Google Play requires an app to explain why it wants location
  before the phone's own permission prompt appears, which is why this screen comes first.
- **The uncertainty circle:** a phone's "accuracy 120 m" means "you're probably within 120 m
  of this point". So with a poor fix, the rule looks at the whole circle: inside only if
  all of it fits in the site, outside only if none of it touches, otherwise "can't tell",
  which is let in with a flag.
- **`blockedPermissions`:** `app.json` tells Android's build to remove a permission even if
  a library asks for it. That's why the check below shows the background permission with
  `tools:node="remove"`.
- **`jest.requireMock()` vs a normal import:** for a mock kept in the root `__mocks__`
  folder, they gave separate copies here, so settings made on one never reached the app's
  code. My first test run failed for this reason, and the new tests use a normal import.

## Files changed
**Shared**
- `packages/shared/src/attendance.ts`, `attendance.test.ts`, `geo.ts`, `geo.test.ts`

**API**
- `apps/api/src/modules/attendance/attendance.routes.ts`, `attendance.service.ts`,
  `attendance.test.ts`
- New: `apps/api/src/lib/gpsVerification.ts`, `gpsVerification.test.ts`

**Mobile**
- `apps/mobile/app.json`, `package.json`, `pnpm-lock.yaml` (repo root)
- `src/strings.ts`, `src/app/_layout.tsx`, `src/app/(tabs)/index.tsx`,
  `src/app/(tabs)/profile.tsx`, `src/components/AttendanceCard.tsx`,
  `src/lib/attendance.ts`, `src/lib/secureStore.ts`
- `src/__tests__/app/attendance.test.tsx`, `src/__tests__/components/AttendanceCard.test.tsx`
- New: `__mocks__/expo-location.js`, `src/app/location-privacy.tsx`,
  `src/components/LocationDisclosure.tsx`, `src/lib/location.ts`, `src/lib/location.test.ts`,
  `src/__tests__/app/home.test.tsx`, `src/__tests__/app/location-privacy.test.tsx`

**Docs**
- `docs/phase2/plan.md`, `architecture-phase2.md`, `api-phase2.md`,
  `database-schema-phase2.md`
- New: `docs/reports/step-2.4.md`, `step-2.4-progress.md`

## Commands run
```
npx expo install expo-location     failed once on a pnpm folder rename, worked on retry
npx expo config --type introspect  apps/mobile, exit 0
pnpm typecheck                     exit 0
pnpm lint                          exit 0
pnpm test                          exit 0, about 5 min 13 s
```

## Test results
| Workspace | Before (step 2.3) | Now |
|---|---|---|
| shared | 259 | 278 |
| api | 516 | 593 |
| mobile | 54 | 96 |
| web | 73 | 73 |
| **Total** | **902** | **1040** |

I didn't start a temporary API server. The API tests already make requests through the real
Express app to the test database, and this step has no web changes.

## Android manifest check
From `npx expo config --type introspect`:
- `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` are present.
- `ACCESS_BACKGROUND_LOCATION` appears only with `tools:node="remove"`.
- There's no `FOREGROUND_SERVICE` or `FOREGROUND_SERVICE_LOCATION` permission, and no iOS
  `UIBackgroundModes` or "Always" text.

**What this doesn't prove:** it shows the app's own config, before libraries are merged in.
The library's manifest, which I read, only adds coarse and fine location, and the removal
rule covers the rest. The final merged list can only be seen in your own build, in step
2.9a. **Expo Go has its own permissions**, so none of this applies to it, and its prompt
says "Expo Go", not our wording.

## Dev database check
Row counts of all 18 tables were identical before and after. No migration, reset or reseed.
My tests used the test database, and my dev queries were read-only.

At the time of the check, `/api/v1/health` on your dev API on port 4000 answered 200. I
didn't stop or start anything on 4000 or 5173.

## Your checklist
**First:** restart Expo, because there's a new library and `app.json` changed. The dev API
restarts by itself, but check it's still up.

**Know your dev settings.** ACME has one office, `ACME Head Office`: OFFICE, GPS required,
200 m. Hours are 08:30–17:00, so late after 08:40, and the day closes at 21:00. A **refused
check-in writes no row**, so you can repeat those. A successful one is once per day.

**The dev DB already has one attendance record for today (2026-11-06), from your 2.3 test.**
If that's Alex, Alex has no check-in left today, and the card won't ask for a location. Use
`manager@acme.test` or `hr@acme.test` for the GPS steps today, or Alex from tomorrow. Item 2
can use today's existing record. After 21:00 no one can check in until the date changes.

**Small fixes:**
1. Home "Pending requests" with nothing pending: normal grey text, not big and bold.
2. A late day shows "Late by 5h 2m" on Home and in the Attendance tab.
3. Check out (when you reach it in step 8): "Are you sure?" appears. Cancel keeps the
   button and records nothing.

**GPS:**
4. Home says "Your location is checked at ACME Head Office."
5. Tap Check in for the first time: the disclosure appears, with 90 days. **Not now** goes
   back. Tap again and **Continue**: the phone's prompt appears. Choose "While using the app".
6. Away from the office: "You are 12.3 km from ACME Head Office." (your real distance), and
   the button stays.
7. On web, set the office's coordinates to your home, and tap Check in again: it works.
   Then in PowerShell:
   ```
   docker exec employee-saas-postgres-1 psql -U employee_saas -d employee_saas -c 'SELECT \"workDate\", status, \"checkInSiteId\" IS NOT NULL AS has_site, \"checkInDistanceM\", \"checkInAccuracyM\", \"checkInWithinRadius\", \"checkOutDistanceM\", \"checkOutWithinRadius\", flags FROM attendance_records ORDER BY \"createdAt\";'
   ```
8. Check out: confirm it, then run the query again. The check-out columns are filled in.
   **Please put the office's real coordinates back afterwards.**
9. **Poor GPS (optional):** indoors, or with Android's "Approximate" location: a check-in
   near the edge goes through with `LOW_ACCURACY`.
10. **Permission refused:** as another user, in Android settings remove the location
    permission, then tap Check in and refuse. A clear message and **Open settings** appear,
    nothing is recorded, and the button works.
11. **Refused check-out:** check in with permission on, remove it, then check out. It goes
    through, flagged `LOCATION_UNAVAILABLE_AT_CHECKOUT`.
12. **Profile → Location & privacy:** the same text and the current permission. Change it in
    settings and come back: it updates.
13. **Mock test (optional):** Developer options → Select mock location app → a free "Fake
    GPS" app, then check in: rejected. Then:
    ```
    docker exec employee-saas-postgres-1 psql -U employee_saas -d employee_saas -c 'SELECT action, metadata, \"createdAt\" FROM audit_logs WHERE action = ''ATTENDANCE_CHECKIN_REJECTED'' ORDER BY \"createdAt\";'
    ```
    **If the check-in isn't rejected, please tell me.** That's the open risk from the plan:
    whether `mocked` is reported with the app you pick.
14. **No GPS needed:** as a BETA employee, or with the office's "GPS required" off: no prompt
    and no location collected.

## Known limitations
- **The mobile screens have only run in tests.** That includes the disclosure, the permission
  flow and real GPS.
- **`mocked` hasn't been tried with a real fake-GPS app** (item 13).
- **An office with no coordinates next to one that requires GPS:** someone at the first is
  judged against the second and refused. Give every office coordinates in that case.
- **"Approximate" location on Android** gives a very poor fix, so those check-ins usually get
  `LOW_ACCURACY` rather than a refusal. Someone can choose this on purpose. HR will see the
  flag from 2.6.
- **Offline with GPS required:** the phone may take up to 15 seconds finding a position before
  saying "No internet connection".
- **The Location & privacy link always shows**, even with attendance off. §3.4 says the text
  is always available.
- **Existing tests:** several older mobile test files call `__reset` through
  `jest.requireMock("expo-secure-store")`. Going by the problem above, that probably clears a
  different copy, so it may do nothing. I didn't confirm that or change them, and they pass.
- **Exact positions aren't purged yet.** The `gps.purge` job comes in step 2.8, so the
  disclosure's retention promise isn't enforced until then.
- **Until 2.6, HR can't see any of this on web.** Flags are only in the API responses and the
  database.

## Exact next step
Run the checklist and check the decisions table. After that, **step 2.5 Site visits + manager
notification**, which reuses `gpsVerification.ts`.
