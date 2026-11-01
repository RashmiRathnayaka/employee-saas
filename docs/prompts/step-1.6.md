# STEP 1.6 — Employee mobile app (MVP)

Read CLAUDE.md, docs/architecture.md, docs/api-phase1.md and docs/reports/step-1.5.md first.

Build the employee mobile app in `apps/mobile` in sub-steps (1.6a → 1.6c).
- Commit after each sub-step.
- Keep a checklist in `docs/reports/step-1.6-progress.md` so that an interrupted or cleared session can continue from it.

## Tech
- Expo (latest stable SDK, so it runs in the current Expo Go app from the Play Store), TypeScript, Expo Router, TanStack Query, react-hook-form + Zod (reuse the schemas from packages/shared), expo-secure-store.
- pnpm monorepo setup:
  - Follow the current official Expo monorepo guidance.
  - Metro must resolve `packages/shared`.
  - If pnpm's isolated node_modules causes Metro/Expo problems, use the officially recommended fix (e.g. node-linker=hoisted scoped as narrowly as possible), and explain the choice in the report.
- API base URL comes from `EXPO_PUBLIC_API_URL` (e.g. `http://192.168.x.x:4000/api/v1`). Add `apps/mobile/.env.example`.
- Make sure the API listens on all interfaces in dev (0.0.0.0), so a phone on the same Wi-Fi can reach it. Document the Windows Firewall rule needed for port 4000.
- All UI text in one strings file (English now; Sinhala/Tamil later).
- Company primary colour applied as the app theme colour.
- Every screen needs loading, empty and error states (with retry), plus pull-to-refresh on lists. Clear messages when the network is unavailable.
- Android first. iOS must still compile; no iOS-only APIs.

## 1.6a — Auth + shell
- API client:
  - sends `X-Client: mobile`
  - stores access + refresh tokens in expo-secure-store
  - on 401, refreshes once and retries the request; only one refresh may run at a time; if the refresh fails, clear the tokens and go to login
- **Login screen:**
  - company code, employee code or email, password; generic error message
  - remember the company code (not the password) for next time
- Forced change-password screen when `mustChangePassword` is true.
- Tab navigation: Home, Leave, Profile.
- Logout calls /auth/logout and clears secure storage.
- If the logged-in user has no employee profile, show a friendly "This app is for employees, please use the web portal" screen.

## 1.6b — Profile + Leave
- **Home:**
  - greeting
  - leave balances summary (available per type)
  - pending requests count
  - next upcoming approved leave
- **Profile:**
  - view employee code, name, department, designation, manager, joining date, contact info
  - edit phone/contact fields (PATCH /employees/me)
- **Leave tab:**
  - balances per type: available / pending / used
  - request list with status chips (PENDING_MANAGER, PENDING_HR, APPROVED, REJECTED, CANCELLED, REVOKED), shown in plain words such as "Waiting for manager"
  - request detail: dates, days, reason, approval history with notes, proof status and due date, Cancel button for pending requests (with confirmation)
- **Apply for leave form:**
  - leave type picker
  - start/end date pickers
  - half-day toggles (only one allowed for a single day)
  - reason
  - calculated total days shown before submitting (use the same day-calculation endpoint as the web)
  - API validation errors shown on the right fields
  - sick leave: past dates allowed per the leave type's rules, and after submitting, prompt to upload proof now or later

## 1.6c — Sick leave proof upload
- Upload from the camera (expo-image-picker) or from files (expo-document-picker; jpg/png/pdf).
- Compress/resize images on the device so they stay well under 5 MB. Show the 5 MB limit and allowed types before picking.
- Multipart upload to the existing endpoint, with progress/loading state and clear error messages from the API.
- Show the document list and review status (Pending review / Accepted / Rejected / Info required + HR note) on the request detail. An INFO_REQUIRED or REJECTED status lets the employee upload another file.
- Opening a document:
  - the API's download URL may be relative (local storage driver); prefix it with the API origin
  - open it with expo-web-browser or the system viewer

## Tests
- jest-expo + React Native Testing Library + MSW (or fetch mocks) for:
  - login (success, generic error)
  - API client: refresh once; two parallel 401s → one refresh; failed refresh → logout
  - forced change-password redirect
  - apply-leave form validation (half-day rule, required fields)
  - status chips mapping
  - upload: rejects a file over 5 MB or of the wrong type before sending
- API tests for any API changes.
- Run all tests, typecheck and lint for the whole workspace.

## Finish
- README section: **"Run the app on your phone"**, step by step for Windows + Android, written for a beginner:
  - same Wi-Fi network
  - find the LAN IP (`ipconfig`)
  - set EXPO_PUBLIC_API_URL
  - firewall rule for port 4000
  - pnpm dev for the API, then start Expo and scan the QR code with Expo Go
  - which seeded employee login to use
  - common errors and their fixes (network request failed, Expo Go SDK mismatch, Metro cannot find packages/shared)
- Update the CLAUDE.md status, commit, and push (if push fails, tell me and continue).
- Write the report to docs/reports/step-1.6.md as described in CLAUDE.md, including a "How to try it on your phone" checklist.
