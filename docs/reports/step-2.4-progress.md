# Step 2.4 progress

Plan: `docs/phase2/plan.md` → 2.4. Report: `docs/reports/step-2.4.md`.

## Requested first
- [x] "Are you sure?" before check-out, with a test
- [x] "Late by 302 min" → "Late by 5h 2m", using `formatDuration`
- [x] Home "Pending requests" empty state uses normal secondary text
- [x] Record the two 2.3 decisions in the docs

## Setup
- [x] Dev row counts snapshot (no migration needed; compared at the end)
- [x] `npx expo install expo-location`
- [x] `app.json` plugin config: foreground permission only

## Shared
- [x] `LocationSchema` on the check-in and check-out bodies
- [x] `gpsRequired` + `officeSite` on the today response
- [x] `formatDistance`

## API
- [x] Pure GPS rules with a test for every row of §3.2
- [x] Nearest-office selection, `checkInSiteId`, `NO_OFFICE_SITE`
- [x] Check-in: rejections, flags, and the audit row on a mock rejection
- [x] Check-out: flags only, never a rejection
- [x] Location discarded when GPS isn't required (Q6)
- [x] Cross-tenant tests

## Mobile
- [x] Reads location only on a tap, foreground only, 15 s timeout
- [x] One-time disclosure before the first permission prompt
- [x] Profile → Location & privacy screen
- [x] Clear messages and a link to settings
- [x] Tests

## Close
- [x] Android manifest check: `ACCESS_BACKGROUND_LOCATION` only as `tools:node="remove"`
- [x] Docs updated
- [x] Dev row counts compared: identical
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`: all exit 0, 1040 tests
- [x] `docs/reports/step-2.4.md`

## Still open
- [ ] Real-device checklist (developer), in the report
