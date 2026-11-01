# Step 1.6 progress checklist

Resume point for an interrupted/cleared session. Check off as completed; keep
notes short — the final write-up goes in `docs/reports/step-1.6.md`.

## STOPPED HERE (2026-11-01, end of 1.6a)

1.6a is complete and verified. Whole-workspace `pnpm typecheck`, `pnpm lint`,
`pnpm test` are all clean (mobile 10/10, web 18/18, api 145/145). Nothing in
this step has been committed — per CLAUDE.md's updated "How to work" rules,
commits/pushes are the developer's own action. Resume at 1.6b (Backend:
EmployeeSchema name objects, then Home/Profile/Leave screens).

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
- [ ] Backend: EmployeeSchema gets department/designation/manager name objects
- [ ] Home: greeting, balances summary, pending count, next upcoming leave
- [ ] Profile: view + edit phone
- [ ] Leave tab: balances, request list w/ status chips (plain-language), detail w/ approval history, cancel
- [ ] Apply-for-leave form: type picker, dates, half-day toggle, reason, live total-days preview, field errors, sick-leave past-dates + proof prompt
- [ ] Tests: apply-leave validation, status chip mapping
- [ ] typecheck/lint/test clean

## 1.6c — Sick leave proof upload
- [ ] Camera (expo-image-picker) + file (expo-document-picker) picking
- [ ] Client-side compress/resize, 5MB/type guard before picking/sending
- [ ] Multipart upload w/ progress + API error surfacing
- [ ] Document list + review status on request detail; re-upload on INFO_REQUIRED/REJECTED
- [ ] Open document via expo-web-browser (prefix relative URL with API origin)
- [ ] Tests: oversized/wrong-type rejected before send
- [ ] Whole-workspace typecheck/lint/test clean

## Finish
- [ ] README "Run the app on your phone" section
- [ ] CLAUDE.md status updated
- [ ] docs/reports/step-1.6.md written
- [ ] Hand off to developer for commit/push (per updated CLAUDE.md rules, this agent no longer commits or pushes)

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
