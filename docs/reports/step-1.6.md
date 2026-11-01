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

### Real-device follow-up, round 1 — Metro bundling fixes

1.6c above was committed and pushed by the developer
(`0eb618f`/`c9344f1`/`0d9d05f`/`398117d`), then tested on a real Android
phone via Expo Go — which caught two bugs neither `pnpm test` nor
`pnpm typecheck`/`pnpm lint` could ever catch, since none of them invoke
Metro's bundler:

- **Metro couldn't resolve `packages/shared`'s own relative imports.**
  `packages/shared/src/index.ts` imports its sibling files with a `.js`
  extension (`./roles.js`) that actually points at a `.ts` file - standard
  TypeScript "NodeNext" ESM style, which `tsc` and Vite (api, web) resolve
  natively but Metro doesn't: "Unable to resolve ./roles.js from
  packages/shared/src/index.ts". Fixed with a `resolver.resolveRequest`
  override in `apps/mobile/metro.config.js`: for a *relative* import
  ending in `.js`, try the same path with `.ts` then `.tsx` first, falling
  back to Metro's normal resolution (still needed for real `.js` files,
  e.g. inside node_modules) if neither exists. `packages/shared`'s source
  itself was left exactly as-is — `api` and `web` both depend on its
  current import style.
- **Expo Router's route scanner was pulling test files into the
  production bundle.** Expo Router builds its route table via a
  `require.context` over the whole `src/app` directory with no filtering
  for test files. `expo start` never hit this (it only bundles what a
  running app actually requests), but `expo export` eagerly bundles the
  entire route-context graph, pulling in `index.test.tsx`,
  `login.test.tsx`, and `(tabs)/leave/apply.test.tsx` and, through them,
  `@testing-library/react-native` → Node's `console` module, which the RN
  runtime doesn't have: "Android Bundling failed ... attempted to import
  the Node standard library module 'console'." Fixed by moving all three
  test files out of `src/app` into `src/__tests__/app/` (mirroring the
  original route paths) and adjusting their relative imports for the new
  depth — no Jest config change needed, since Jest's default `testMatch`
  already picks up `**/__tests__/**` anywhere in the project.

Verified with `npx expo export --platform android`: "Android Bundled"
(1284 modules, no errors) — confirmed Metro can bundle the whole app
before the developer tries their phone again. Re-ran
`pnpm --filter @employee-saas/mobile test` (still 17/17, same suite, just
relocated) and the whole-workspace typecheck/lint. Deleted the export's
`dist/` output afterward (already covered by the root `.gitignore`'s
`dist/` rule — confirmed with `git check-ignore -v`). Added this failure
mode to the README's common-errors table.

### Real-device follow-up, round 2 — date picker, proof upload, logging security

Further device testing (round 1's fixes applied but not yet committed)
found two more bugs plus a security issue in the API's own request logs:

- **The apply-leave date picker only ever "picked" today.** Root cause:
  `DateField.tsx`'s `toIsoDate()` built the stored value from
  `date.toISOString().slice(0, 10)`, which converts to UTC first — for a
  device ahead of UTC (Asia/Colombo is UTC+5:30), a local midnight can
  land on the *previous* UTC day; `apply.tsx`'s own `todayIso()` had the
  same bug. Fixed by adding local-calendar-field helpers
  (`toLocalIsoDate`/`todayLocalIsoDate`/`addDaysToIsoDate`) to
  `src/lib/formatDate.ts` and using them everywhere a picked date becomes
  an ISO string, instead of `toISOString()`. Also gave `<DateTimePicker>`
  a `key` that bumps on every open (forces Android to mount a fresh native
  dialog each time, rather than risk reusing a prior one's state — a
  documented issue class for this library on Android), and fixed
  `minimumDate` to actually mirror the API's real rule
  (`PAST_DATE_WINDOW_DAYS = 30`): a leave type with `allowPastDates` now
  bounds the picker to 30 days back instead of being unbounded; one
  without it still bounds to today. No upper bound exists in the API, so
  no `maximumDate` was added.
- **Sick leave proof upload: picking a photo failed before any request
  reached the API** (confirmed from the API's own access logs — zero
  POSTs, only the web browser's GETs). Root cause: `proofUpload.ts`'s
  `compressImage()` requested `saveAsync({ base64: true })` purely to
  measure the compressed image's size, round-tripping the *entire*
  recompressed image through the JS bridge as a giant string before the
  function even returned — on a real device this broke the upload before
  any network call. Fixed by installing `expo-file-system`
  (`npx expo install expo-file-system`) and reading the saved file's size
  directly off `File#size` (a plain filesystem stat, no bridge transfer)
  instead of requesting base64 at all. Separately, `apiClient.ts`'s
  `apiRequest()` had a bare `catch { throw NETWORK_ERROR }` around
  `fetch()`, discarding whatever the real error was and always blaming
  Wi-Fi — fixed to keep the real error (logged via `console.warn` in
  `__DEV__` only, never shown to the user or sent anywhere) and, for a
  multipart upload specifically, throw a new `UPLOAD_FAILED` code with an
  honest message instead. Double-checked the other RN `FormData`/`fetch`
  pitfalls explicitly: `apiClient.ts` never sets `Content-Type` manually
  for a FormData body, the file part is already the RN-standard
  `{ uri, name, type }` shape with a real MIME type, and the `uri` was
  already `file://` in every picker path (camera/gallery save to disk via
  `ImageManipulator`; "choose a file" uses `copyToCacheDirectory: true`).
  **Correction, round 3 below: the `{ uri, name, type }` file part itself
  was in fact the remaining broken piece** - this assessment was wrong,
  and the dev-only error logging added in this same round is exactly what
  caught it on the next device retest.
- **Security: pino-http was logging the full `cookie` header** (carries
  the web app's access/refresh tokens), and would have logged
  `authorization` (the mobile app's bearer token) and any `Set-Cookie`
  response header too — nothing redacted any of it. Fixed in
  `apps/api/src/lib/logger.ts` with pino's own `redact` option
  (`req.headers.cookie`, `req.headers.authorization`,
  `res.headers["set-cookie"]` → `"[REDACTED]"`), which applies to every
  request pino-http logs through this logger instance.

Added tests where the bug was reachable as pure logic: `formatDate.test.ts`
(the new local-date helpers, including month/year-boundary cases),
`apiClient.test.ts` (`UPLOAD_FAILED` vs. `NETWORK_ERROR` depending on
whether the failed request was a multipart upload), and
`apps/api/src/lib/logger.test.ts` (builds a logger with the exact same
`redactOptions` the app uses, logs headers containing real token values,
and asserts the token values never appear in the output — only
`"[REDACTED]"` does). The native picker/compression interactions
themselves still aren't unit-testable for the reason noted in 1.6c.

Verified with whole-workspace `pnpm typecheck`/`pnpm lint`/`pnpm test`
(mobile 24/24, web 18/18, api 147/147, all clean), then
`npx expo export --platform android` again ("Android Bundled", 1302
modules, no errors), and deleted `dist/` once more afterward.

### Real-device follow-up, round 3 — the actual upload fix, and a deprecation warning

Round 2's dev-only error logging (`console.warn` in `apiClient.ts`) paid
off immediately on the next device retest, surfacing the real error that
had been hidden behind the generic Wi-Fi message before round 2:

```
WARN [apiClient] POST /leave-requests/.../documents failed before a response: [Error: Unsupported FormDataPart implementation]
```

- **The actual cause**: Expo SDK 58's `fetch` no longer accepts the
  classic React Native FormData file-part shape (`{ uri, name, type }`) -
  it only accepts a genuine Blob-like value. Fixed in
  `UploadProofSection.tsx` by appending an `expo-file-system` `File`
  instance directly - `File implements Blob` and reads straight off disk,
  which is the currently-documented pattern for this exact case:
  `formData.append("file", new File(file.uri), file.name)`. The API
  endpoint was not touched - purely a client-side request-construction
  fix. `PickedProofFile.mimeType` is kept for the pre-upload
  `validateProofFile` check; the actual multipart Content-Type for the
  file part now comes from the `File`'s own `.type` (derived from its
  on-disk extension - verified this still matches in every picker path:
  camera/gallery save as `.jpg` via `ImageManipulator`, "choose a file"
  preserves the original extension via `copyToCacheDirectory: true`).
- **`DateTimePicker`'s `onChange` prop is deprecated** (a runtime warning
  on the real device: "Use onValueChange, onDismiss and
  onNeutralButtonPress instead"). Moved `DateField.tsx` onto the three new
  props. This actually simplified the component: `onValueChange` only
  ever fires with a real picked date (no more `event.type === "set"`
  check), `onDismiss` covers cancellation, and neither needs the old
  `Platform.OS` branching the single `onChange` handler had. No neutral
  button is configured, so `onNeutralButtonPress` wasn't implemented.
  Updated the Jest mock to call `onValueChange` instead of `onChange`.
  **Correction, round 4 below: this round also added a `key={openCount}`
  remount trick to "force a fresh native dialog on each open," reasoning
  about a hypothetical Android staleness bug - that reasoning was wrong,
  and the fix actively made the real underlying bug (not yet found at
  this point) worse, not better.**

No new tests were added this round - both fixes are in code paths that
need a real native module (`expo-file-system`'s `File`, the real native
date dialog) to exercise meaningfully; the existing 24 mobile tests
(unchanged in count, since the mock's prop rename doesn't add or remove
assertions) confirm nothing else regressed. Verified with
`pnpm --filter @employee-saas/mobile test` (24/24), whole-workspace
`pnpm typecheck`/`pnpm lint` (clean), and `npx expo export --platform
android` again ("Android Bundled", 1302 modules, no errors), then deleted
`dist/` once more.

### Real-device follow-up, round 4 — the actual date-picker fix

Round 3's date-picker fix was also necessary but not sufficient. On
retest, `minimumDate` worked correctly (could navigate back to a past
month for sick leave), but **navigating the dialog to a different month
and trying to confirm a date there always snapped back to today - OK
never actually took effect for any date outside the current month.**

- **The actual cause**: `DateField.tsx` rendered `<DateTimePicker>`
  *inline* on Android (as it had since 1.6b, through round 3), which ties
  that native dialog's lifecycle to React's render tree. Any re-render of
  the surrounding apply-leave form while the dialog is open - react-hook-
  form's `watch()` fires on every keystroke, the debounced total-days
  preview query settles mid-interaction - remounts the `<DateTimePicker>`
  element, and remounting an *open* native Android dialog just reopens it
  fresh at `value`, discarding whatever month/day the user had navigated
  to. Round 2's `key={openCount}` "force a fresh dialog" trick made this
  *worse*, not better, since it guaranteed a remount on the next render
  regardless. A single-tap pick within the already-shown month might
  never visibly glitch, which is plausibly why three earlier rounds of
  testing hadn't caught this specific interaction.
- **Fix**: switched Android to this library's own recommended
  Android-specific API, the imperative
  `DateTimePickerAndroid.open({ value, mode, minimumDate, onValueChange,
  onDismiss })` - a single native call with **no element placed in the
  React tree at all**, so there is nothing for a parent re-render to
  remount; the bug class is closed rather than patched around. iOS keeps
  the original declarative `<DateTimePicker>` (it renders inline, not as
  a modal, so it was never subject to this failure mode) -
  `Platform.OS` branches in a new `openPicker()` function and in what
  gets rendered. Removed the `key`/`openCount` trick entirely - it was
  never the right fix, and no longer applies to the platform it was aimed
  at.

Added `src/components/ui/DateField.test.tsx`, forcing `Platform.OS =
"android"` (a plain, directly-reassignable property on a module-scoped
object - confirmed this project's jest-expo environment defaults to
`"ios"`, which is exactly why `apply.test.tsx` never exercised the
Android branch and so never caught any of this): asserts
`DateTimePickerAndroid.open` is called once with the correct
`value`/`minimumDate`, the picked date reaches `onChange`, and no inline
dialog element is ever rendered for Android. The mock
(`__mocks__/@react-native-community/datetimepicker.js`) now also exports
a `DateTimePickerAndroid.open` jest mock that invokes `onValueChange`
synchronously - mirroring the real module's "no rendered element" shape
for Android, versus the existing `<DateTimePicker>` mock's rendered
"Confirm date" pressable for iOS. `apply.test.tsx` needed no changes - it
runs under the default "ios" platform and keeps exercising the unchanged
inline component.

Verified with `pnpm --filter @employee-saas/mobile test` (26/26 - the 24
from before, unchanged, plus 2 new), whole-workspace
`pnpm typecheck`/`pnpm lint` (clean), and `npx expo export --platform
android` again ("Android Bundled", 1302 modules, no errors), then deleted
`dist/` once more.

## Files changed

**1.6a/1.6b** (already committed/pushed by the developer): commits
`b8ff0bc`, `992cdeb`, `bb06d1f`, `da90859`, `6d417a4`, `b58a617`, plus
`cf4206d` (an unrelated test-performance fix to argon2 cost in tests,
committed separately). See `docs/reports/step-1.6-progress.md` for the full
file list per commit.

**1.6c** was committed and pushed by the developer across commits
`0eb618f`, `c9344f1`, `0d9d05f`, `398117d` — see those commits (or
`docs/reports/step-1.6-progress.md`) for the full file list.

**Real-device follow-up, rounds 1-4** (uncommitted — none of the four
rounds were committed before the next one's work started, so all four
are now one set of pending changes):
- New: `apps/api/src/lib/logger.test.ts`,
  `apps/mobile/src/lib/formatDate.test.ts`,
  `apps/mobile/src/components/ui/DateField.test.tsx`.
- Edited: `apps/mobile/metro.config.js` (the `.js`→`.ts`/`.tsx` resolver
  override), `apps/api/src/lib/logger.ts` (redaction),
  `apps/mobile/src/components/ui/DateField.tsx` (local-date fix,
  `onChange`→`onValueChange`/`onDismiss`, and - the actual fix - Android
  switched to the imperative `DateTimePickerAndroid.open` API),
  `apps/mobile/__mocks__/@react-native-community/datetimepicker.js`,
  `apps/mobile/src/app/(tabs)/leave/apply.tsx`,
  `apps/mobile/src/lib/formatDate.ts`, `apps/mobile/src/lib/proofUpload.ts`,
  `apps/mobile/src/components/UploadProofSection.tsx` (the actual upload
  fix - `File`-as-Blob), `apps/mobile/src/lib/apiClient.ts`,
  `apps/mobile/src/lib/apiClient.test.ts`, `apps/mobile/src/strings.ts`,
  `apps/mobile/package.json`, `pnpm-lock.yaml` (`expo-file-system` added),
  `README.md` (new common-errors row).
- Moved (with adjusted relative imports): `apps/mobile/src/app/index.test.tsx`
  → `apps/mobile/src/__tests__/app/index.test.tsx`;
  `apps/mobile/src/app/login.test.tsx` →
  `apps/mobile/src/__tests__/app/login.test.tsx`;
  `apps/mobile/src/app/(tabs)/leave/apply.test.tsx` →
  `apps/mobile/src/__tests__/app/(tabs)/leave/apply.test.tsx`.
- New, untracked: `apps/mobile/.gitignore` (auto-generated by `npx expo
  install` further back, ignoring the generated `expo-env.d.ts`; never
  added until now).
- `docs/reports/step-1.6-progress.md`, `docs/reports/step-1.6.md` (this
  file).

## Commands run

```
npx expo export --platform android         # round 1, 1st run: failed on packages/shared's ./roles.js (pre-fix)
pnpm --filter @employee-saas/mobile test    # round 1: 17/17, confirms the moved test files still work
npx expo export --platform android         # round 1, 2nd run, after both fixes: "Android Bundled" (1284 modules)
npx expo install expo-file-system           # round 2: added at the SDK 58-aligned version (~58.0.13)
pnpm --filter @employee-saas/mobile typecheck   # clean
pnpm --filter @employee-saas/mobile lint        # clean
pnpm --filter @employee-saas/mobile test        # round 2: 24/24 (17 + formatDate + apiClient additions)
pnpm --filter @employee-saas/api test           # 147/147, incl. the new logger redaction test
pnpm typecheck    # all 4 workspaces — clean
pnpm lint         # all 4 workspaces — clean
pnpm test         # all 4 workspaces — clean: mobile 24/24, web 18/18, api 147/147
npx expo export --platform android         # round 2, final check: "Android Bundled" (1302 modules), clean
rm -rf apps/mobile/dist                     # export output, cleaned up (already gitignored)
pnpm --filter @employee-saas/mobile typecheck   # round 3 (File-as-Blob upload + onValueChange) — clean
pnpm --filter @employee-saas/mobile lint        # clean
pnpm --filter @employee-saas/mobile test        # round 3: 24/24, unchanged count
pnpm typecheck    # all 4 workspaces — clean
pnpm lint         # all 4 workspaces — clean
npx expo export --platform android         # round 3, final check: "Android Bundled" (1302 modules), clean
rm -rf apps/mobile/dist                     # cleaned up again
pnpm --filter @employee-saas/mobile typecheck   # round 4 (DateTimePickerAndroid.open) — clean
pnpm --filter @employee-saas/mobile lint        # clean
pnpm --filter @employee-saas/mobile test        # round 4: 26/26 (24 + 2 new DateField Android tests)
pnpm typecheck    # all 4 workspaces — clean
pnpm lint         # all 4 workspaces — clean
npx expo export --platform android         # round 4, final check: "Android Bundled" (1302 modules), clean
rm -rf apps/mobile/dist                     # cleaned up again
```

## Test results

- **Mobile: 26/26 passing** (`pnpm --filter @employee-saas/mobile test`) —
  13 from 1.6a/1.6b, 4 from 1.6c's `fileValidation.test.ts`, plus 9 from
  the real-device follow-up rounds: 5 in `formatDate.test.ts` (the new
  local-calendar-date helpers, including month- and year-boundary cases
  for `addDaysToIsoDate`), 2 in `apiClient.test.ts` (`UPLOAD_FAILED` vs.
  `NETWORK_ERROR` depending on whether a failed-before-response request
  was a multipart upload), and 2 in `DateField.test.tsx` (forcing
  `Platform.OS = "android"`: `DateTimePickerAndroid.open` is called with
  the right `value`/`minimumDate`, and no inline dialog element is ever
  rendered). Round 3's upload fix added no new tests - not reachable
  without a real native module.
- **API: 147/147 passing** (`pnpm --filter @employee-saas/api test`) — 146
  from before this step plus 1 new in `logger.test.ts` (the pino
  `redactOptions` config, asserting real token values never appear in a
  logged line, only `"[REDACTED]"` does).
- **Web: 18/18 passing** — unaffected by this step.
- **Typecheck and lint clean** across all 4 workspaces.
- **`npx expo export --platform android` bundles cleanly** (1302 modules,
  no errors) — this is new: earlier versions of this report only ran the
  usual three commands, which is exactly how the Metro bundling bugs in
  round 1 went unnoticed until a real device caught them.
- Not covered by automated tests: the native camera/gallery/file-picker
  interactions themselves — see Known limitations.

## Known limitations

- **No automated test coverage for the native pickers themselves** (the
  actual camera/gallery/document picker UI, the real native date dialog)
  — jest-expo doesn't exercise real native modules, so these have been
  exercised on a real Android device four times across these follow-up
  rounds (each round fixed every bug the previous passes found - round
  2's dev logging is what made round 3's actual root cause visible
  instead of another guess, and round 4 fixed the date picker's real
  cause after round 3's fix turned out to be incomplete). What *is*
  covered: all the pure logic (file validation, the local-date helpers,
  the upload-vs-network error distinction) and - new this round - that
  `DateField` calls the correct Android API with the correct arguments
  and renders no element for it (`DateField.test.tsx`), which is as close
  to the real bug as a mock can get without an actual device. A config or
  native-module change in this area still needs a manual device check,
  not just the automated suite — see the checklist below.
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

1. **Leave** tab → **Apply for leave** → pick the sick-leave type → tap the
   start date field and **navigate to a different month** (back to last
   month, since sick leave allows up to 30 days back) **before** tapping a
   day and OK. Confirm the day you actually picked sticks - this exact
   interaction (change month, then pick) is the one that silently snapped
   back to today through rounds 1-3; round 4 is the one that actually
   fixed it. Also try picking a date more than 30 days back for the start
   date - the native picker itself should refuse to go that far back (its
   `minimumDate`). Shouldn't see the "onChange is deprecated" warning
   either (round 3).
2. Fill in the rest and submit. You'll be prompted to upload proof now or
   later — try both paths.
3. On the request's detail screen, tap **Upload proof** (or **Upload
   another file** if proof was rejected/needs more info) → try each of the
   three options:
   - **Take a photo** — grant camera permission, take a photo, confirm it
     actually uploads (a POST should appear in the API's terminal output)
     and appears in the document list as "Pending review". This exact path
     failed silently through rounds 1 and 2 - round 3 is the one that
     actually fixed it (the earlier "fix" was a real improvement but not
     the actual cause).
   - **Choose from gallery** — same, from an existing photo.
   - **Choose a file** — pick a PDF (or an image) from the Files app.
4. Try picking a file over 5 MB or of an unsupported type (e.g. a `.docx`)
   — it should be rejected immediately, before any network call, with a
   clear message.
5. Tap an uploaded document in the list — it should open in the browser
   (or system PDF viewer).
6. As HR (a separate login, on the web portal — mobile has no HR role), go
   to that leave request and mark the document **Rejected** or **Info
   required** with a note. Back on the phone, refresh the request detail
   screen: the note should show, and the upload button should reappear as
   "Upload another file".
7. Deny the camera/photo-library permission once (from the phone's app
   settings) and retry — should show a clear "permission is required"
   message, not a crash.
8. While testing, keep an eye on the API's own terminal output (or
   whatever's tailing its logs) — a request's `cookie`/`authorization`
   header and any `Set-Cookie` response header should show
   `"[REDACTED]"`, never the real token value.

## Next step

Step 1.7 — In-app notifications (the backend already writes
`createNotification` rows from several modules; this step adds a way to
read/mark-read them, plus a web screen and likely a mobile notifications
screen).

## For the developer: suggested commits

1.6c itself is already committed and pushed. Everything from all four
real-device follow-up rounds is still uncommitted (none of the four got
committed before the next one's work started). Suggested as three
separate commits, by concern — the file moves are already staged by
`git mv`:

```
# 1. Metro bundling (round 1)
git add apps/mobile/metro.config.js apps/mobile/.gitignore \
        "apps/mobile/src/__tests__/app/index.test.tsx" \
        "apps/mobile/src/__tests__/app/login.test.tsx" \
        "apps/mobile/src/__tests__/app/(tabs)/leave/apply.test.tsx"

git commit -m "fix(mobile): resolve Metro bundling failures found on a real device" \
  -m "packages/shared's NodeNext-style .js imports needed a Metro resolver override (tries .ts/.tsx first). Expo Router's route scanner was also pulling *.test.tsx files into the production bundle via its src/app require.context, which failed on @testing-library/react-native's use of Node's console module - moved the three route test files to src/__tests__/app/, mirroring their original paths. Verified with npx expo export --platform android."

# 2. Date picker + proof upload (rounds 2-4, mobile)
git add apps/mobile/src/lib/formatDate.ts apps/mobile/src/lib/formatDate.test.ts \
        apps/mobile/src/components/ui/DateField.tsx apps/mobile/src/components/ui/DateField.test.tsx \
        apps/mobile/__mocks__/@react-native-community/datetimepicker.js \
        "apps/mobile/src/app/(tabs)/leave/apply.tsx" \
        apps/mobile/src/lib/proofUpload.ts apps/mobile/src/components/UploadProofSection.tsx \
        apps/mobile/src/lib/apiClient.ts apps/mobile/src/lib/apiClient.test.ts \
        apps/mobile/src/strings.ts apps/mobile/package.json pnpm-lock.yaml

git commit -m "fix(mobile): fix date picker losing a pick across months, and silent proof-upload failures" \
  -m "DateField rendered <DateTimePicker> inline on Android, tying the native dialog to React's render tree - any re-render of the surrounding form while open (react-hook-form's watch(), a debounced preview query) remounted it and snapped the selection back to today, which only showed up on a multi-step pick (change month, then confirm). Switched Android to the imperative DateTimePickerAndroid.open() this library recommends, which puts no element in the tree at all. Also replaced toIsoDate()/todayIso()'s toISOString() (converts to UTC, can land on the wrong local day) with local-calendar-field helpers, bound minimumDate to the API's real 30-day past-dates rule, and moved off the deprecated onChange onto onValueChange/onDismiss. Separately, proof upload failed two ways: saveAsync({base64:true}) bridged the whole recompressed image as a string just to measure its size (switched to expo-file-system's File#size), and - the actual root cause, only visible once apiRequest() stopped swallowing the real fetch error - Expo SDK 58's fetch rejects the classic RN FormData file-part shape ({uri,name,type}), accepting only a real Blob; fixed by appending an expo-file-system File directly. apiRequest() now also reports UPLOAD_FAILED (not the Wi-Fi-specific NETWORK_ERROR) for a multipart request failing before reaching the network, and logs the real error in dev."

# 3. Logging security fix (round 2, api)
git add apps/api/src/lib/logger.ts apps/api/src/lib/logger.test.ts

git commit -m "fix(api): redact auth cookie, authorization, and set-cookie headers from request logs" \
  -m "pino-http was logging req.headers in full, including the cookie header carrying the web app's access/refresh tokens. Added pino's redact option for req.headers.cookie, req.headers.authorization, and res.headers[\"set-cookie\"]."

# 4. Docs
git add README.md docs/reports/step-1.6-progress.md docs/reports/step-1.6.md

git commit -m "docs: record real-device follow-up fixes for step 1.6"
```
