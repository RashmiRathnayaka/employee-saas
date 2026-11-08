# Step 2.9a progress: dev build (no push code)

Plan: `docs/phase2/plan.md` → 2.9a. Setup steps: `architecture-phase2.md` §4.7.

## Before 2.9a: your answers to the 2.8 questions
- [x] Q1: "overdue" only covers proof due in the last 30 days (`OVERDUE_LOOKBACK_DAYS`) + a test
- [x] Q2: half-day leave keeps getting the check-in reminder (docs only, no code change)
- [x] Architecture §5.4 updated for both
- [x] `proofReminders.test.ts`: 13 of 13

## 2.9a
- [x] Check what's on disk: pnpm 12.16.1, node 22.14.0, isolated (not hoisted) node_modules, no Android SDK (not needed)
- [x] `npx expo install expo-dev-client` (58.0.18; first try hit a Windows rename error, the retry worked)
- [x] `eas.json` with the `development` profile (+ pinned node/pnpm for EAS)
- [x] ~~Clean clone check~~: dropped, your call (work in the project folder only)
- [x] `expo-doctor`: found `expo-font` and `expo-linking` missing → added (your approval)
- [x] `expo-doctor`: duplicate `expo-constants` (58.0.14 + 58.0.15 via expo-linking) → bumped to 58.0.15
- [x] `expo-doctor` 19/20; the one left is 5 version bumps you deferred
- [x] `expo config`: background location is removed from the manifest
- [x] Mobile typecheck, lint, tests (167/167), after each dependency change
- [x] **You:** Expo account + `eas login`
- [x] **You:** `eas init` (interactive). It also wrote copies of plugin values into `app.json`; removed, permissions unchanged
- [x] `eas config` accepts the development profile
- [x] **You:** the cloud build. Succeeded on the first try
- [x] Docs: README, architecture §4.7, plan, CLAUDE.md commands
- [x] Full workspace check: typecheck ✓, lint ✓, `pnpm test` ✗ (2 mobile timeouts under load) → mobile rerun ✓ 167, web ✓ 178
- [x] Report `docs/reports/step-2.9a.md`
- [ ] **You:** install on the phone, run from the dev build (report → "Your checklist")
