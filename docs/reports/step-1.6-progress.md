# Step 1.6 progress checklist

Resume point for an interrupted/cleared session. Check off as completed; keep
notes short — the final write-up goes in `docs/reports/step-1.6.md`.

## STEP 1.6 COMPLETE (2026-11-01)

1.6a, 1.6b, and 1.6c are all done and verified. 1.6a and 1.6b were
committed and pushed by the developer directly. 1.6c (this session) is
verified but not yet committed — per CLAUDE.md's "How to work" rules,
commits/pushes are the developer's own action. See docs/reports/step-1.6.md
for the full write-up and commit message suggestion.

## 1.6a — Auth + shell
- [x] Expo app scaffolded in `apps/mobile` (Expo Router, TS)
- [x] pnpm monorepo + Metro resolves `packages/shared` (document the fix used)
- [x] `EXPO_PUBLIC_API_URL` env wiring + `.env.example`
- [x] API listens on 0.0.0.0 in dev (Node's default `app.listen(port)` already binds all interfaces — no API code change needed); firewall rule still needs documenting in the README (Finish step)
- [x] strings file (English)
- [x] API client: X-Client mobile, secure-store tokens, single-flight refresh+retry
- [x] Login screen (company code, identifier, password; remembers company code)
- [x] Forced change-password screen
- [x] Tab nav: Home / Leave / Profile
- [x] Logout
- [x] "no employee profile" screen
- [x] Company primary colour as theme colour (via `usePrimaryColor()`, GET /company)
- [x] Tests: login, refresh-once logic, forced change-password redirect
- [x] typecheck/lint/test clean (whole workspace)

## 1.6b — Profile + Leave
- [x] Backend: EmployeeSchema gets department/designation/manager name objects
- [x] Home: greeting, balances summary, pending count, next upcoming leave
- [x] Profile: view + edit phone
- [x] Leave tab: balances, request list w/ status chips (plain-language), detail w/ approval history, cancel
- [x] Apply-for-leave form: type picker, dates, half-day toggle, reason, live total-days preview, field errors, sick-leave past-dates + proof prompt
- [x] Tests: apply-leave validation (required fields + half-day rule), status chip mapping
- [x] typecheck/lint/test clean

## 1.6c — Sick leave proof upload
- [x] Camera (expo-image-picker) + file (expo-document-picker) picking
- [x] Client-side compress/resize, 5MB/type guard before picking/sending
- [x] Multipart upload w/ loading state + API error surfacing
- [x] Document list + review status on request detail; re-upload on INFO_REQUIRED/REJECTED
- [x] Open document via expo-web-browser (prefix relative URL with API origin)
- [x] Tests: oversized/wrong-type rejected before send
- [x] Whole-workspace typecheck/lint/test clean

## Finish
- [x] README "Run the app on your phone" section
- [x] CLAUDE.md status updated
- [x] docs/reports/step-1.6.md written
- [x] Hand off to developer for commit/push (per updated CLAUDE.md rules, this agent no longer commits or pushes)

## Notes / decisions log
(append short dated notes here as decisions are made, so a resumed session has them)

- 2026-10-31: `apps/mobile` scaffolded by hand (not `create-expo-app`, to avoid
  its demo UI) — Expo SDK 58, Expo Router (file-based routes under `src/app`,
  auto-detected), TanStack Query, react-hook-form+Zod reusing
  `packages/shared` schemas directly, expo-secure-store.
- Monorepo wiring: `apps/mobile/.npmrc` sets `node-linker=hoisted` **scoped to
  this package only** (pnpm respects a per-project `.npmrc` for the linker
  strategy) - not at the repo root, because apps/web pins React 18 and
  Expo SDK 58 requires React 19; hoisting at the root would force one React
  version across the whole workspace. `apps/mobile/metro.config.js` adds the
  workspace root to `watchFolders` and both node_modules dirs to
  `resolver.nodeModulesPaths`, which is the standard fix for Metro
  resolving a pnpm-workspace sibling package (`packages/shared`).
- 2026-10-31: CLAUDE.md's "How to work" updated — this agent no longer runs
  `git commit` or `git push`; it stops at the end of each step/sub-step and
  hands the developer a changed-files list, what to test, and a suggested
  commit message instead.
- 2026-11-01: Resumed after the network issue cleared. Fixed along the way
  (all discovered empirically, not guessed):
  - `pnpm install` needed two native build-script approvals
    (`@parcel/watcher`, `unrs-resolver`) added to `pnpm-workspace.yaml`'s
    `allowBuilds`/`onlyBuiltDependencies` — same mechanism already used for
    prisma/argon2/esbuild/msw.
  - `@testing-library/react-native@14` requires a NEW peer package called
    `test-renderer` (not `react-test-renderer`, which React 19 deprecated) -
    added as a devDependency. Its `render()` and `fireEvent.*` are now
    `async` and must be awaited (previously synchronous in v13) - RNTL's
    `screen` singleton only updates after that promise resolves, so an
    un-awaited `render()` leaves `screen.getByText(...)` throwing "render
    function has not been called".
  - Tried MSW for mobile tests first, hit a real dead end: msw's own
    `exports` map sets `"react-native": null` for its `./node` subpath, and
    jest-expo's test environment always includes `"react-native"` as an
    active export condition, so Jest's resolver fell through to an
    ESM-only build it can't `require()`. Per instruction, dropped MSW from
    mobile entirely and switched both test files to a tiny local
    `global.fetch` mock (route table keyed by `METHOD pathname`, returning
    real `Response` objects) - same test cases, no framework fighting.
    apps/web's own MSW setup is untouched.
  - `packages/shared`'s source uses `.js`-extension imports pointing at
    `.ts` files (the standard TS "NodeNext" convention) - Vite/Vitest (web,
    api) resolve this natively, but Jest doesn't, so
    `apps/mobile/package.json`'s jest config maps relative `*.js` imports
    back to extensionless (`"^(\\.{1,2}/.*)\\.js$": "$1"`), letting Jest's
    normal extension resolution find the `.ts` file.
  - Biggest one: once two React majors existed in the workspace (web=18,
    mobile=19), pnpm's `node_modules/.pnpm/node_modules` convenience-hoist
    layer nondeterministically picked ONE `@types/react` to hoist
    workspace-wide, and apps/web's `tsc` picked up the wrong one (19) via
    `react-router-dom`'s own `.d.ts` files, which reference `'react'`
    types without declaring `@types/react` as a real dependency. Fixed in
    `pnpm-workspace.yaml` two ways together: `hoistPattern` excludes
    `react`/`react-dom`/`@types/react`/`@types/react-dom` from that hoist
    layer entirely, and `packageExtensions` gives `react-router`/
    `react-router-dom` an explicit `@types/react`(-dom) dependency so they
    resolve it the same deterministic way they resolve their `react`/
    `react-dom` peers (scoped to web's React 18, no hoisting needed).
  - `apps/api`'s generated Prisma client went stale mid-reinstall (its
    postinstall couldn't find the schema from a nested path) - fixed with
    `pnpm --filter @employee-saas/api db:generate`.
  - End state: `pnpm typecheck`, `pnpm lint`, `pnpm test` all clean across
    all 4 workspaces (mobile 10/10, web 18/18, api 145/145).
- 2026-11-01, 1.6b:
  - Backend: `EmployeeSchema` (packages/shared) gets nested `department`,
    `designation`, `manager` name objects alongside the existing *Id
    fields. Needed because an EMPLOYEE's own role can't call
    `GET /employees/:id` for their manager (self/team/admin-only per
    docs/api-phase1.md), so without this the mobile Profile screen would
    have no way to show a manager's name at all. All Prisma queries in
    `employees.service.ts` that return a full employee now `include` these
    three relations (all already existed on the `Employee` model - no
    migration needed). New API test:
    "resolves department, designation, and manager as nested name objects,
    and null when unset".
  - Added `@react-native-community/datetimepicker` (asked first, per
    CLAUDE.md - approved) for the apply-leave form's start/end date
    pickers; `npx expo install` picked the SDK 58-compatible version and
    registered its config plugin in app.json automatically.
  - Leave tab restructured from a flat `(tabs)/leave.tsx` into a nested
    Stack (`(tabs)/leave/{_layout,index,apply,[id]}.tsx`) so the list,
    apply form, and detail screen can navigate between each other within
    the tab; the outer Tabs.Screen for "leave" sets `headerShown: false`
    so the inner Stack's own headers aren't doubled up.
  - Real bug caught by the apply-leave test, not just a test-authoring
    issue: react-hook-form only calls `onSubmit` when the resolver
    (zodResolver) says the *whole* form is valid. `CreateLeaveRequestSchema`'s
    `leaveTypeId` is a bare `z.string()` (no `.min(1)`), so an empty
    selection alone never fails the resolver - but when startDate/endDate
    are ALSO empty (and those DO fail the isoDate regex), `onSubmit` never
    ran at all, so the manual "leave type is required" check inside it
    never fired either. Fixed with `handleSubmit(onSubmit, onInvalid)`,
    calling the same leaveTypeId check from both.
  - Mocked `@react-native-community/datetimepicker` for tests
    (`apps/mobile/__mocks__/@react-native-community/datetimepicker.js`) -
    renders a plain pressable "Confirm date" instead of a real OS dialog.
    First attempt read the test-picked date back via a module-local
    variable + `jest.requireMock(...).__setNextPickedDate(...)`, mirroring
    the `expo-secure-store` mock's `__reset` pattern from 1.6a - but the
    component kept seeing today's real date instead, implying the test and
    the component were resolving to different cached instances of the
    mock. Switched to a `globalThis` property instead (set directly by the
    test, read directly by the mock's onPress), which sidesteps the issue
    entirely since `globalThis` can't have two instances.
  - Follow-up requested before commit: the apply-leave form was showing
    `CreateLeaveRequestSchema`'s raw zod regex message ("must be
    YYYY-MM-DD") when a date field was left empty - a developer-facing
    message, not a user-facing one. Fixed in `apply.tsx` with explicit
    friendly messages per field (`leaveTypeRequired`/`startDateRequired`/
    `endDateRequired` in strings.ts), applied via `handleSubmit(onSubmit,
    onInvalid)` so they override the resolver's own message immediately,
    not just after the fact. Test updated to assert the raw message never
    appears (`queryByText("must be YYYY-MM-DD")` is null) alongside the
    friendly ones.
  - Combined `pnpm -r test` (web+api+mobile in parallel) hit a Postgres
    deadlock + a 5s test timeout in `leaveDecisions.test.ts`. First guess
    ("transient resource contention, not a real issue") was wrong, and
    the developer correctly pushed back on it - re-investigated and found
    a real, fixable cause: `argon2.hash()` was called with its library
    defaults (64 MiB memory cost, by design expensive - that's the whole
    point for real passwords) everywhere a login gets created, including
    `createTestUser`/`setUpCompanyWithUser`, which nearly every API test
    calls at least once. Under the extra CPU contention from three
    parallel test runners, the cumulative hashing cost in a
    multi-employee test (the one that failed creates 3 logins) pushed it
    past vitest's 5s default timeout. Vitest's timeout only abandons the
    *test* - it doesn't cancel the in-flight Prisma transaction - so that
    abandoned transaction was still running when the *next* test's
    `beforeEach` truncate fired, and the two collided: a real deadlock,
    just not an application logic bug (confirmed no un-awaited
    `tx.*`/`$transaction` calls anywhere in the leave request/decision
    services - all notification writes are properly inside `await
    Promise.all(...)`). Fixed at the root: new
    `apps/api/src/lib/passwordHashing.ts` exports `hashPassword()`, which
    uses argon2's normal (strong) defaults everywhere except
    `NODE_ENV==="test"`, where it uses a much cheaper cost - test security
    never depended on hash strength, and `argon2.verify()` always reads
    the real parameters back out of the hash string itself, so lowering
    the cost for test-created accounts doesn't need any corresponding
    change anywhere else. Replaced every direct `argon2.hash()` call site
    (auth/companies/employees/users services, plus the `createTestUser`
    test helper) with this helper. Side effect: the whole api suite got
    noticeably faster too (~140s -> ~70-80s). Verified by running the
    root `pnpm test` 3 times in a row after the fix - all 3 green.
- 2026-11-01, 1.6c:
  - No API changes needed - the sick-leave-document endpoints
    (`apps/api/src/modules/leaveDocuments`) already covered everything
    this sub-step required (upload, list, download URL, HR review),
    built back in Step 1.4.
  - `expo-image-picker`, `expo-document-picker`, `expo-image-manipulator`,
    and `expo-web-browser` were already present in `package.json` from the
    1.6a scaffold (anticipating this sub-step) but unused until now. Ran
    `npx expo install --check` before writing any native-module code and
    found all four, plus `expo-secure-store` (in active use since 1.6a),
    pinned below SDK 58's expected range (e.g. `expo-image-picker@17.0.11`
    vs. expected `~58.0.10` - Expo moved several first-party modules to
    track the SDK's own major version number starting with SDK 58). Ran
    `npx expo install --fix`, which bumped all five to their SDK
    58-aligned versions and auto-added `expo-secure-store` to
    `app.json`'s `plugins` array (now required by that package's newer
    config-plugin setup). Re-ran typecheck/lint/test after the bump -
    all clean; no API shape changes in the packages actually used.
  - Used `expo-image-manipulator`'s current (non-deprecated) API
    (`ImageManipulator.manipulate(uri).resize(...).renderAsync()` then
    `.saveAsync(...)`) rather than the older `manipulateAsync()` function,
    which is still exported for backwards compatibility but flagged
    `@deprecated` in its own types.
  - Avoided adding `expo-file-system` as a new dependency just to read back
    a compressed image's byte size: `saveAsync({ base64: true, ... })`
    already returns the image as a base64 string, and a base64 string's
    decoded byte length is computable directly from its own length
    (`floor(length * 3/4) - padding`), so no extra native module was
    needed. Document-picker files don't need this at all -
    `DocumentPickerAsset.size` is already in bytes.
  - Client-side validation (`src/lib/fileValidation.ts`) deliberately
    mirrors the API's own allow-list (jpg/png/pdf, 5 MB) exactly, so a
    rejected file fails fast on-device with the same rule the server would
    apply, instead of failing only after an upload round-trip.
  - Reused the existing `api.upload()` (plain `fetch`-based multipart,
    already written in 1.6a's API client) rather than building a separate
    `XMLHttpRequest`-based path for a literal upload-percentage progress
    bar. React Native's `fetch` has no upload-progress event, and the
    step's "progress/loading state" wording is satisfied by a spinner +
    "Uploading..." label - the web portal's own equivalent upload (Step
    1.5) only shows a loading state too, so this keeps both clients
    consistent and avoids a second HTTP code path to maintain.
  - Picker/compression code (`src/lib/proofUpload.ts`) and the native
    camera/gallery/file-picker interactions themselves have no automated
    test coverage - jest-expo doesn't exercise real native pickers, and
    mocking three separate native modules' happy/cancel/permission-denied
    paths wasn't judged worth the cost for an MVP; the one thing explicitly
    required to be tested (reject-before-send on type/size) is pure logic
    in `fileValidation.ts` and is fully covered. Documented as a known
    limitation in the README for a manual on-device check.
  - Replaced the README's old terse "Mobile (Expo) on a LAN device" note
    with the full beginner "Run the app on your phone" walkthrough the
    step asked for (same Wi-Fi, `ipconfig`, `.env`, firewall rule, two
    terminals, QR scan, which seeded login to use, common errors) and
    folded the old note's file-download point into it. Also deleted a
    stale "Known limitations" bullet claiming `apps/mobile` was still a
    placeholder package - that stopped being true back in 1.6a.
- 2026-11-01, real-device follow-up (two bugs found by actually running
  Expo Go on a phone - neither caught by `pnpm test`/`typecheck`/`lint`,
  which never invoke Metro's bundler):
  - **Metro couldn't resolve `packages/shared`'s own relative imports.**
    `packages/shared/src/index.ts` imports its sibling files with a `.js`
    extension (`./roles.js`) that actually points at a `.ts` file -
    standard TypeScript "NodeNext" ESM style, which `tsc` and Vite (api,
    web) resolve natively but Metro doesn't, failing with "Unable to
    resolve ./roles.js from packages/shared/src/index.ts". Fixed in
    `apps/mobile/metro.config.js` with a `resolver.resolveRequest`
    override: for a *relative* import ending in `.js`, try the same path
    with `.ts` then `.tsx` first, falling back to Metro's normal
    resolution (which still covers real `.js` files, e.g. inside
    node_modules) if neither exists. Scoped to relative imports only, so
    package imports are untouched, and `packages/shared`'s source itself
    was left exactly as-is, since `api` and `web` both depend on its
    current import style.
  - **Expo Router's route scanner was pulling test files into the
    production bundle.** Expo Router builds its route table via a
    `require.context` over the whole `src/app` directory, with no
    filtering for test files - fine for `expo start` (which only bundles
    what's actually requested at runtime, so a test file never gets
    touched in normal use), but `expo export` eagerly bundles the full
    route-context graph, which pulled in `index.test.tsx`,
    `login.test.tsx`, and `(tabs)/leave/apply.test.tsx` and, through them,
    `@testing-library/react-native` - which imports Node's `console`
    module, not available in the RN runtime: "Android Bundling failed ...
    attempted to import the Node standard library module 'console'."
    Fixed by moving all three test files out of `src/app` into
    `src/__tests__/app/` (mirroring the original route paths, e.g.
    `src/__tests__/app/(tabs)/leave/apply.test.tsx`), adjusting their
    relative imports for the new depth. No Jest config change was needed -
    Jest's default `testMatch` already picks up `**/__tests__/**` and
    `*.test.*` anywhere in the project, it isn't scoped to `src/app`.
    Verified with `npx expo export --platform android`: "Android Bundled"
    (1284 modules, no errors), re-ran `pnpm --filter @employee-saas/mobile
    test` (still 17/17, same suite, just relocated), then deleted the
    export's `dist/` output (already covered by the root `.gitignore`'s
    `dist/` rule - confirmed with `git check-ignore -v`).
  - General takeaway, worth remembering for later sub-steps: neither
    `pnpm test` nor `pnpm typecheck`/`pnpm lint` ever invoke Metro, so a
    real bundling problem (a bad resolver config, something only the route
    scanner touches) can sit invisible through every automated check this
    project runs until someone actually opens the app on a device or runs
    `expo export`. Worth doing an `expo export --platform android` sanity
    check before considering a mobile sub-step done, not just the usual
    three commands.
- 2026-11-01, second real-device round (date picker + proof upload + a
  logging security issue, found by actually using the app on the phone and
  by reading the API's own logs):
  - **Apply-leave date picker only ever "picked" today.** Root cause in
    `src/components/ui/DateField.tsx`: `toIsoDate()` built the stored ISO
    string from `date.toISOString().slice(0, 10)`, which converts to UTC
    first - for a device ahead of UTC (Asia/Colombo is UTC+5:30), a local
    midnight can land on the *previous* UTC day. `apply.tsx`'s own
    `todayIso()` had the identical bug. Fixed by adding
    `toLocalIsoDate`/`todayLocalIsoDate`/`addDaysToIsoDate` to
    `src/lib/formatDate.ts` (local calendar-field formatting, never
    `toISOString()` for a date-only value) and using them everywhere a
    picked date becomes a stored ISO string. Also gave `<DateTimePicker>`
    a `key` that bumps on every open, forcing Android to mount a fresh
    native dialog instance each time rather than risk reusing a prior
    one's state - a documented class of bug for this exact library on
    Android. While in there, also fixed `minimumDate` to actually match
    the API's real rule (`PAST_DATE_WINDOW_DAYS = 30` in
    `leaveRequests.service.ts`): a leave type with `allowPastDates` now
    bounds the picker to 30 days back (not unbounded past, which the
    server would reject anyway only after a submit attempt); one without
    it still bounds to today. No `maximumDate` was added - the API has no
    upper bound on a future start date, so there's nothing to mirror.
    Added `src/lib/formatDate.test.ts` for the new helpers (pure
    functions, easy to pin down exactly, including a month and a
    year-boundary case for `addDaysToIsoDate`).
  - **Sick leave proof upload: picking a photo failed before any request
    reached the API** (confirmed from the API's own access logs - zero
    POSTs logged, only the web browser's GETs). Root cause in
    `src/lib/proofUpload.ts`'s `compressImage()`: it requested
    `saveAsync({ ..., base64: true })` purely to measure the compressed
    image's byte size, which means the *entire* recompressed image gets
    round-tripped through the JS bridge as a giant base64 string before
    the function even returns - on a real device this either throws or
    corrupts the rest of the flow, which `UploadProofSection`'s mutation
    then reported as a generic network error because
    `apps/mobile/src/lib/apiClient.ts`'s `apiRequest()` had a bare
    `catch { throw NETWORK_ERROR }` around the `fetch()` call, discarding
    whatever the real thrown error actually was. Fixed two ways: (1)
    installed `expo-file-system` (`npx expo install expo-file-system`,
    SDK-aligned version `~58.0.13`) and read the saved file's size
    directly off its `File#size` property (a plain filesystem stat, no
    base64, no bridge round-trip) instead of requesting base64 at all; (2)
    `apiRequest()`'s catch now keeps the real error (`console.warn` in
    `__DEV__` only - never shown to the user, never sent anywhere, just a
    raw JS `Error` for local debugging) and, for a multipart upload
    specifically (`options.isFormData`), throws a new `UPLOAD_FAILED` code
    with an honest message ("Could not prepare or send the file...")
    instead of the Wi-Fi-specific one, since a failure before any bytes
    leave the device is a file problem, not a connectivity one. Verified
    the RN `FormData`/fetch pitfalls the developer asked to double-check
    were already correct and needed no change: `apiClient.ts` never sets
    `Content-Type` manually for a FormData body (lets `fetch` add its own
    multipart boundary), the file part is already the RN-standard
    `{ uri, name, type }` shape, `type` is already a real MIME type, and
    the `uri` was already a `file://` path in every picker path (camera/
    gallery go through `ImageManipulator.saveAsync`, which writes to disk
    and returns a real file URI; "choose a file" uses
    `copyToCacheDirectory: true`, which copies into a `file://` cache path
    even when the original pick was a `content://` URI) - so the base64
    step was genuinely the one thing to fix, not a symptom of those other
    pitfalls. Added two `apiClient.test.ts` cases (`UPLOAD_FAILED` for a
    thrown fetch on a FormData request vs. `NETWORK_ERROR` for a plain
    JSON request) - can't unit-test the native picker/compression path
    itself for the same reason noted in 1.6c (jest-expo doesn't exercise
    real native modules).
  - **Security: pino-http was logging the full `cookie` header (carries
    the web app's access/refresh tokens) and would have logged
    `authorization` (the mobile app's bearer token) and any `Set-Cookie`
    response header too.** Fixed in `apps/api/src/lib/logger.ts` with
    pino's own `redact` option (`req.headers.cookie`,
    `req.headers.authorization`, `res.headers["set-cookie"]` →
    `"[REDACTED]"`) - this applies to every request pino-http logs through
    this logger instance, not something each route has to opt into
    separately. Exported the redact config as `redactOptions` so
    `src/lib/logger.test.ts` can build a logger with the exact same
    settings (writing to an in-memory array instead of stdout) and assert
    a logged request/response containing real token values never actually
    contains them, only `"[REDACTED]"` - a direct, fast unit test of the
    pino config itself rather than a slower, less deterministic
    supertest-against-a-live-server test (the test environment also runs
    the logger at `level: "silent"`, so nothing would reach a real
    assertion that way without first changing the level).
  - Verified with: whole-workspace `pnpm typecheck`/`pnpm lint`/`pnpm test`
    (mobile 24/24, web 18/18, api 147/147, all clean), then
    `npx expo export --platform android` again ("Android Bundled", 1302
    modules, no errors) and deleted `dist/` again afterward.
- 2026-11-01, third real-device round: round 2's "fix" for the proof
  upload turned out to be necessary but not sufficient - dev logging
  (added in round 2, specifically so this would be visible) surfaced the
  actual error on retest: `[Error: Unsupported FormDataPart implementation]`.
  Correcting the earlier write-up's assumption: the base64-bridge theory
  was a real bug worth fixing, but Expo SDK 58's fetch has its own,
  separate requirement - it rejects the classic React Native FormData file
  part (`{ uri, name, type }`), accepting only genuine Blob-like values.
  Fixed in `UploadProofSection.tsx` by appending an `expo-file-system`
  `File` instance directly (`new File(file.uri)` - it `implements Blob`),
  with the filename as `FormData.append`'s third argument. The API
  endpoint itself didn't change - this was entirely a client-side request
  construction issue. `PickedProofFile.mimeType` is kept for client-side
  `validateProofFile` checks; the actual uploaded Content-Type now comes
  from the `File`'s own `.type` (derived from its on-disk extension, which
  matches in every current picker path: camera/gallery save as `.jpg` via
  `ImageManipulator`, and "choose a file" preserves the original extension
  via `copyToCacheDirectory: true`).
  - Also moved `DateField.tsx` off `@react-native-community/datetimepicker`'s
    deprecated single `onChange` prop (flagged by a runtime warning on the
    real device: "onChange is deprecated. Use onValueChange, onDismiss and
    onNeutralButtonPress instead") onto the three new props. This
    simplified the component slightly: `onValueChange` only ever fires
    with an actual picked date (no more `event.type === "set"` check
    needed), and `onDismiss` covers cancellation - both just close the
    picker, so the `Platform.OS` branching in the old single handler was no
    longer needed either. `onNeutralButtonPress` wasn't implemented - no
    neutral button is configured, so Android will never call it. Updated
    the Jest mock (`__mocks__/@react-native-community/datetimepicker.js`)
    to call `onValueChange` instead of `onChange`.
  - Verified with `pnpm --filter @employee-saas/mobile test` (still 24/24,
    same suite - the picker mock's prop rename doesn't change what any
    test asserts), whole-workspace `pnpm typecheck`/`pnpm lint` (clean),
    and `npx expo export --platform android` again ("Android Bundled",
    1302 modules, no errors), then deleted `dist/` once more.
- 2026-11-01, fourth real-device round: round 3's date-picker fix (local
  calendar dates, `minimumDate`, the `onChange`→`onValueChange`/`onDismiss`
  migration) was necessary but still not sufficient - on a real Android
  device, `minimumDate` worked correctly, but navigating the dialog to a
  different month and trying to confirm a date always snapped back to
  today, with OK never actually taking effect. Root cause (correctly
  diagnosed from the device behavior, not guessed): rendering
  `<DateTimePicker>` *inline* on Android - what this component had done
  since 1.6b, including through round 3 - ties that native dialog's
  lifecycle to React's render tree. The `key={openCount}` remount trick
  added in round 2 (meant to fix a *different*, hypothetical staleness
  issue) was actually making this worse, not better: any re-render of the
  surrounding apply-leave form while the dialog is open - react-hook-form's
  `watch()` fires on every keystroke, the debounced total-days preview
  query settles mid-interaction - remounts the `<DateTimePicker>` element,
  and a remount of an open native Android dialog just reopens it fresh at
  `value`, discarding whatever month/day the user had navigated to.
  Multi-step interactions (change month, then pick a day, then tap OK) are
  exactly what exposes this, since there's more time for an unrelated
  re-render to land mid-interaction; a single-tap pick on today's own
  month-view might never visibly glitch, matching why this had not been
  caught by rounds 1-3's testing.
  - Fixed by switching Android to this library's own recommended
    Android-specific API: the imperative `DateTimePickerAndroid.open({
    value, mode, minimumDate, onValueChange, onDismiss })`, which makes a
    single native call with **no element placed in the React tree at
    all** - there is nothing for a parent re-render to remount, by
    construction, so the bug class is closed rather than patched around.
    iOS keeps the original declarative `<DateTimePicker>` approach (it
    renders inline, not as a modal, so it was never subject to this
    failure mode) - `Platform.OS` branches in `openPicker()` and in what
    gets rendered. Removed the now-pointless `key`/`openCount` remount
    trick entirely, since it was never the right fix and no longer
    applies to the platform it was aimed at.
  - Test mock (`__mocks__/@react-native-community/datetimepicker.js`) now
    also exports a `DateTimePickerAndroid.open` jest mock that invokes the
    passed `onValueChange` synchronously - mirroring the real module's "no
    rendered element" shape for Android, versus the existing
    `<DateTimePicker>` mock's rendered "Confirm date" pressable for iOS.
    Added `src/components/ui/DateField.test.tsx`, forcing
    `Platform.OS = "android"` for its two tests (RN's `Platform.OS` is a
    plain, directly-reassignable property on a module-scoped object, a
    standard RN testing technique - confirmed it resolves to `"ios"` by
    default in this project's jest-expo environment, which is exactly why
    the existing `apply.test.tsx` suite never exercised the Android branch
    at all and so never caught any of this): asserts
    `DateTimePickerAndroid.open` is called exactly once with the correct
    `value`/`minimumDate`, that the picked date is reported via `onChange`,
    and that no `mock-date-time-picker` element is ever rendered for
    Android. `apply.test.tsx` itself needed no changes - it runs under the
    default "ios" platform and continues exercising the unchanged inline
    component + its existing mock.
  - Verified with `pnpm --filter @employee-saas/mobile test` (26/26 - the
    24 from before, unchanged, plus the 2 new Android-specific tests),
    whole-workspace `pnpm typecheck`/`pnpm lint` (clean), and
    `npx expo export --platform android` again ("Android Bundled", 1302
    modules, no errors), then deleted `dist/` once more.
