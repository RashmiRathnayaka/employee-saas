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
