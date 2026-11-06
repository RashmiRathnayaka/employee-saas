# Step 2.5 progress

Plan: `docs/phase2/plan.md` → 2.5. Report: `docs/reports/step-2.5.md`.

## Setup
- [x] Dev row counts snapshot, before any migration

## Shared
- [x] Site visit schemas, statuses, flags (`AFTER_HOURS`, `ON_ABSENT_DAY`)
- [x] `SITE_CHECKED_IN` notification type
- [x] `openVisit` on the today response

## API
- [x] `site_visits` table, hand-written indexes and CHECKs
- [x] Freeze check on the generated SQL
- [x] Migration applied to test and dev, dev row counts compared
- [x] Check-in: site GPS rules, retry, one open visit
- [x] First visit starts the attendance day (§1.6)
- [x] `AFTER_HOURS` and `ON_ABSENT_DAY`, row left alone
- [x] Check-out, and day check-out closes an open visit in the same transaction
- [x] `SITE_CHECKED_IN` to the manager, in the same transaction
- [x] Me, team and HR lists, and one visit, with no coordinates for managers
- [x] Cross-tenant and `MODULE_DISABLED` tests

## Real servers
- [x] Temporary API on 4001 and Vite on 5199, test database, stopped afterwards

## Mobile
- [x] Site card on Home: check in, open-visit banner with a timer, check out
- [x] Site picker with search
- [x] My visits
- [x] Tests

## Web
- [x] Site visits page: on site now, history
- [x] Notification opens the page
- [x] Tests

## Close
- [x] Docs updated
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`: all exit 0, 1269 tests
- [x] Dev row counts compared at the end: only the migration, the new table and 2 refresh tokens not from this work
- [x] `docs/reports/step-2.5.md`

## Still open
- [ ] Real-device checklist (developer), in the report
