# Step 1.6 Report — Employee mobile app (MVP)

## What was done

Built the Phase 1 mobile MVP in `apps/mobile` (previously a bare placeholder
package), in three sub-steps per `docs/prompts/step-1.6.md`. 1.6a and 1.6b
were committed and pushed by the developer directly; 1.6c (sick leave proof
upload) is this session's work, verified but not yet committed. A progress
checklist (`docs/reports/step-1.6-progress.md`) was kept throughout — it has
the detailed, sub-step by sub-step account (including every build/tooling
problem hit and how it was fixed); this report summarizes.

### 1.6a — Tooling, auth, app shell
- Expo (SDK 58) scaffolded by hand in `apps/mobile` (not `create-expo-app`,
  to skip its demo UI), with Expo Router (file-based routes), TypeScript,
  TanStack Query, react-hook-form + Zod reusing `packages/shared` schemas
  directly, and `expo-secure-store`.
- pnpm monorepo wiring: `apps/mobile/.npmrc` scopes `node-linker=hoisted` to
  this package only (Expo SDK 58 needs React 19; `apps/web` is pinned to
  React 18, so hoisting at the repo root would force one React version
  workspace-wide), and `metro.config.js` adds the workspace root to
  `watchFolders` plus both `node_modules` dirs to `resolver.nodeModulesPaths`
  so Metro can resolve `packages/shared`.
- API client (`src/lib/apiClient.ts`): sends `X-Client: mobile`, stores
  tokens in `expo-secure-store`, single-flight refresh-then-retry on a 401
  (concurrent 401s share one `/auth/refresh` call).
- Login screen (company code, employee code/email, password; remembers the
  company code, not the password), forced change-password screen, tab shell
  (Home/Leave/Profile), logout, and a friendly "This app is for employees"
  screen for logins with no employee profile.
- Company primary colour applied as the app's accent colour
  (`usePrimaryColor()` → `GET /company`).

### 1.6b — Profile + Leave
- Home (greeting, leave balance summary, pending-requests count, next
  upcoming approved leave), Profile (view + edit phone), and the Leave tab
  (balances, request list with plain-language status chips, request detail
  with approval history, cancel), restructured as a nested Stack so list →
  apply → detail can navigate within the tab.
- Apply-for-leave form: leave type picker, start/end date pickers
  (`@react-native-community/datetimepicker`, added via `npx expo install`),
  half-day toggles with the single-day mutual-exclusion rule, a live
  total-days preview against the same preview endpoint the web app uses,
  field-level API error mapping, and a post-submit prompt to upload sick
  leave proof now or later.
- Backend addition: `EmployeeSchema` (packages/shared) gained nested
  `department`/`designation`/`manager` name objects (an EMPLOYEE's own role
  can't call `GET /employees/:id` for anyone else, so without this the
  Profile screen had no way to show a manager's name at all).

### 1.6c — Sick leave proof upload
- Upload from the camera (`expo-image-picker`) or from files
  (`expo-document-picker`; jpg/png/pdf). Images are resized (max width
  1600px) and recompressed to JPEG (`expo-image-manipulator`'s current
  `manipulate().resize().renderAsync().saveAsync()` API) before validation,
  so a multi-MB phone photo lands well under the 5 MB limit.
- Client-side validation (`src/lib/fileValidation.ts`) mirrors the API's
  own allow-list (jpg/png/pdf, 5 MB) exactly, rejecting a bad file before
  any network call, with the 5 MB/type limits shown up front in the picker
  menu.
- Multipart upload reuses the existing `api.upload()` (`fetch`-based,
  built in 1.6a) with a loading spinner + "Uploading..." label and the
  API's own error message surfaced on failure.
- Request detail screen now shows the document list with each one's review
  status (Pending review / Accepted / Rejected / Info required) and HR
  note; an upload button appears while proof is `MISSING`, and re-appears
  as "Upload another file" on `INFO_REQUIRED`/`REJECTED`.
- Opening a document: the API's download URL is prefixed with the API
  origin when relative (the `local` storage driver's URLs are), then opened
  via `expo-web-browser`.
- No API changes were needed — the sick-leave-document endpoints
  (`apps/api/src/modules/leaveDocuments`, built in Step 1.4) already
  covered upload, list, download URL, and HR review.
- Dependency housekeeping: `expo-image-picker`, `expo-document-picker`,
  `expo-image-manipulator`, `expo-web-browser` were already in
  `package.json` from the 1.6a scaffold (unused until now); `npx expo
  install --check` found these plus `expo-secure-store` pinned below SDK
  58's expected range, and `npx expo install --fix` brought all five up to
  their SDK-58-aligned versions (also auto-registering `expo-secure-store`
  as an `app.json` config plugin, now required by its newer setup).

## Files changed

**1.6a/1.6b** (already committed/pushed by the developer): commits
`b8ff0bc`, `992cdeb`, `bb06d1f`, `da90859`, `6d417a4`, `b58a617`, plus
`cf4206d` (an unrelated test-performance fix to argon2 cost in tests,
committed separately). See `docs/reports/step-1.6-progress.md` for the full
file list per commit.

**1.6c** (this session, uncommitted):
- New: `apps/mobile/src/lib/fileValidation.ts`,
  `apps/mobile/src/lib/fileValidation.test.ts`,
  `apps/mobile/src/lib/proofUpload.ts`,
  `apps/mobile/src/components/UploadProofSection.tsx`.
- Edited: `apps/mobile/src/app/(tabs)/leave/[id].tsx` (renders
  `UploadProofSection`), `apps/mobile/src/lib/queries.ts` (added
  `useLeaveDocuments`), `apps/mobile/src/strings.ts` (added
  `upload.permissionDenied`).
- Dependency bump: `apps/mobile/package.json`, `apps/mobile/app.json`,
  `pnpm-lock.yaml` (`npx expo install --fix` — see above).
- Docs: `CLAUDE.md` (status checkbox), `README.md` (new "Run the app on
  your phone" section, replacing the old terse LAN note; removed a stale
  "no Expo app yet" limitations bullet; added a limitation about upload
  test coverage), `docs/reports/step-1.6-progress.md`,
  `docs/reports/step-1.6.md` (this file).

```
 CLAUDE.md                                 |  2 +-
 README.md                                 | 83 +++++++++++++++++++++++----
 apps/mobile/app.json                      |  3 +-
 apps/mobile/package.json                  |  8 +--
 apps/mobile/src/app/(tabs)/leave/[id].tsx |  7 +++
 apps/mobile/src/lib/queries.ts            | 10 ++++
 apps/mobile/src/strings.ts                |  1 +
 docs/reports/step-1.6-progress.md         | 94 ++++++++++++++++++++++++-------
 pnpm-lock.yaml                            | 54 ++++++++++--------
 9 files changed, 201 insertions(+), 61 deletions(-)
 + 4 new files (fileValidation.ts/.test.ts, proofUpload.ts, UploadProofSection.tsx)
```

## Commands run

```
npx expo install --check     # (apps/mobile) found 5 packages below SDK 58's expected range
npx expo install --fix       # bumped them; auto-added expo-secure-store to app.json plugins
pnpm --filter @employee-saas/mobile typecheck   # clean
pnpm --filter @employee-saas/mobile lint        # clean
pnpm --filter @employee-saas/mobile test        # 17/17 passing
pnpm typecheck    # all 4 workspaces — clean
pnpm lint         # all 4 workspaces — clean
pnpm test         # all 4 workspaces — clean (run once this session; see Test results)
```

## Test results

- **Mobile: 17/17 passing** (`pnpm --filter @employee-saas/mobile test`) —
  13 from 1.6a/1.6b (login, refresh-once logic, forced change-password
  redirect, apply-leave validation, status chip mapping) plus 4 new in
  `fileValidation.test.ts`: accepts an allowed type at/under 5 MB, rejects
  over 5 MB, rejects an unsupported type, and checks type before size (an
  oversized *and* unsupported file reports the type error, matching the
  API's own check order).
- **Web: 18/18 passing**, **API: 146/146 passing** — unaffected by this
  step, run as part of the whole-workspace `pnpm test`.
- **Typecheck and lint clean** across all 4 workspaces.
- Not covered by automated tests: the native camera/gallery/file-picker
  interactions themselves, and image compression — see Known limitations.

## Known limitations

- **No automated test coverage for the native pickers** — jest-expo
  doesn't exercise real camera/gallery/document pickers, and mocking three
  separate native modules' happy/cancel/permission-denied paths wasn't
  judged worth it for an MVP. The one thing the step explicitly required
  to be tested (reject-before-send on type/size) is pure logic and is
  fully covered. **This sub-step needs a manual check on a real Android
  device** before considering it done end-to-end — see the checklist below.
- **Upload shows a loading spinner, not a numeric progress bar** — React
  Native's `fetch` has no upload-progress event; building a separate
  `XMLHttpRequest` path just for a percentage wasn't judged worth a second
  HTTP code path, and matches the web portal's own upload UI (loading
  state only).
- Carried over from 1.6a/1.6b (see `step-1.6-progress.md` for the full
  list): no in-app notification UI yet (Step 1.7); no automated
  proof-deadline reminders.

## How to try it on your phone

Full step-by-step setup is now in the README's **"Run the app on your
phone"** section (Wi-Fi, `ipconfig`, `.env`, firewall rule, starting the
API + Expo, which seeded login to use, common errors). Once the app is
running and you're logged in as an employee whose company has a leave type
requiring proof (e.g. sick leave):

1. **Leave** tab → **Apply for leave** → pick the sick-leave type → fill in
   dates → submit. You'll be prompted to upload proof now or later — try
   both paths.
2. On the request's detail screen, tap **Upload proof** (or **Upload
   another file** if proof was rejected/needs more info) → try each of the
   three options:
   - **Take a photo** — grant camera permission, take a photo, confirm it
     uploads and appears in the document list as "Pending review".
   - **Choose from gallery** — same, from an existing photo.
   - **Choose a file** — pick a PDF (or an image) from the Files app.
3. Try picking a file over 5 MB or of an unsupported type (e.g. a `.docx`)
   — it should be rejected immediately, before any network call, with a
   clear message.
4. Tap an uploaded document in the list — it should open in the browser
   (or system PDF viewer).
5. As HR (a separate login, on the web portal — mobile has no HR role), go
   to that leave request and mark the document **Rejected** or **Info
   required** with a note. Back on the phone, refresh the request detail
   screen: the note should show, and the upload button should reappear as
   "Upload another file".
6. Deny the camera/photo-library permission once (from the phone's app
   settings) and retry — should show a clear "permission is required"
   message, not a crash.

## Next step

Step 1.7 — In-app notifications (the backend already writes
`createNotification` rows from several modules; this step adds a way to
read/mark-read them, plus a web screen and likely a mobile notifications
screen).

## For the developer: suggested commit

1.6c is uncommitted. Suggested changed-files list and message:

```
git add apps/mobile/src/lib/fileValidation.ts apps/mobile/src/lib/fileValidation.test.ts \
        apps/mobile/src/lib/proofUpload.ts apps/mobile/src/components/UploadProofSection.tsx \
        apps/mobile/src/app/"(tabs)"/leave/\[id\].tsx apps/mobile/src/lib/queries.ts apps/mobile/src/strings.ts \
        apps/mobile/package.json apps/mobile/app.json pnpm-lock.yaml \
        README.md CLAUDE.md docs/reports/step-1.6-progress.md docs/reports/step-1.6.md

git commit -m "feat(mobile): add sick leave proof upload" \
  -m "Camera/gallery/file picking with client-side type+size validation and on-device image compression, matching the API's existing jpg/png/pdf/5MB rule. Also brings expo-image-picker, expo-document-picker, expo-image-manipulator, and expo-secure-store up to their SDK 58-aligned versions (npx expo install --fix)."
```
