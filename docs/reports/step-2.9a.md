# Step 2.9a Report: Dev build (no push code)

Plan: `docs/phase2/plan.md` → 2.9a. Setup: `architecture-phase2.md` §4.7. Checklist: `docs/reports/step-2.9a-progress.md`.

**Status: the first EAS cloud build succeeded. Typecheck and lint pass, and all 1836 tests pass (two mobile tests
timed out in the full run and passed on a rerun, see below). It hasn't run on your phone yet. That's your
checklist below.**

Build: https://expo.dev/accounts/rashmirathnayaka02/projects/employee-saas-mobile/builds/ea407f08-3140-4881-ada6-746185892fe0

## What was done
### Before 2.9a: your answers to the 2.8 questions
- **"Overdue" only covers the last 30 days.** `leave.proofOverdue` now looks at proof due from today − 30 days to
  yesterday (`OVERDUE_LOOKBACK_DAYS`). Proof due exactly 30 days ago is still included, and 31 days ago isn't. A new test
  covers 30 days, 31 days and a year-old request.
- **Half-day leave keeps the check-in reminder.** There's no code change, and architecture §5.4 records your decision.

### 2.9a
| What | Why |
|---|---|
| `expo-dev-client` 58.0.18 (approved, Q23) | Turns the app into a dev build: your own APK that still loads JS from `expo start` |
| `apps/mobile/eas.json`, `development` profile: dev client, internal, APK | As planned (§4.7 step 6) |
| `eas.json` pins `node` 22.14.0 and `pnpm` 12.16.1 | The lockfile and `pnpm-workspace.yaml` (`allowBuilds`, release-age rules) need the pnpm that wrote them. EAS's default pnpm could ignore or reject them |
| `expo-font` 58.0.11 and `expo-linking` 58.0.16 (**your approval today**) | Found by `expo-doctor`: peers of `@expo/vector-icons` and `expo-router`. Expo Go has them built in. A dev build only includes native modules in the app's own `package.json`, so it could crash on start without them. `expo install` also added the `expo-font` plugin to `app.json` |
| `expo-constants` 58.0.14 → 58.0.15 | `expo-linking` brought its own 58.0.15. A native build can only hold one copy of a native module. This is the only one of the six deferred upgrades I made, because the approved `expo-linking` required it |
| `app.json`: `extra.eas.projectId` + `owner` | Written by `eas init` (you ran it). Not secret |

**No hoisting change was needed.** The workspace's isolated `node_modules` worked as is in EAS.

## Decisions the design didn't cover
| # | Situation | What I did | Why |
|---|---|---|---|
| 1 | `eas init` also wrote an explicit `android.permissions` list and `extra.router.asyncRoutes` into `app.json` | Removed both. Kept only `projectId` and `owner` | Both are copies of what plugins compute anyway. An explicit permissions list can change which default permissions Expo keeps. I checked that the manifest's permissions are the same before and after |
| 2 | Five other `expo-doctor` version bumps | Deferred (your decision) | Suggested for 2.9b, which rebuilds the native code anyway (see the plan) |
| 3 | Which Expo account owns the project | `rashmirathnayaka02` (personal), not the team account | You gave this account. A project can be moved to a team later |

## New concepts (plain language)
- **Development build:** a version of your app compiled with exactly your native libraries. Expo Go is one generic app with a
  fixed set of native libraries built in. A dev build is yours, so it can include push notifications, which Expo Go dropped.
  It still fetches your JavaScript live from your PC, so you rarely rebuild.
- **When to rebuild:** only when *native* code changes, such as a new library with Android code, or `app.json` plugins and
  permissions. Editing screens, hooks or API calls never needs a rebuild.
- **Peer dependency:** a library saying "I need this other library, but *you* must install it." In Expo Go these were
  satisfied silently by what's built in. `expo-doctor` is the tool that spots them before a build.
- **Keystore:** the private key that signs the APK. Android only installs signed apps, and only lets an app update if it's
  signed by the same key. EAS made it and keeps it on your Expo account, so nothing secret is in the repo.
- **`expo start` mode:** with `expo-dev-client` installed, `expo start` targets the dev build by default. Press `s` to switch to
  Expo Go.

## Files changed
**API:** `src/modules/leaveRequests/proofReminders.job.ts`, `proofReminders.test.ts`.

**Mobile:** `package.json`, `app.json`. New: `eas.json`.

**Root:** `pnpm-lock.yaml` (additions only, plus the `expo-constants` bump), `README.md` (a dev build section), `CLAUDE.md`
(two commands).

**Docs:** `docs/phase2/plan.md`, `architecture-phase2.md` (§4.7 "What 2.9a found", §5.4 for the 2.8 answers). New:
`docs/reports/step-2.9a.md`, `step-2.9a-progress.md`.

## Commands run
```
vitest run src/modules/leaveRequests/proofReminders.test.ts   13 of 13
npx expo install expo-dev-client                               failed once (Windows rename error), the retry worked
npx expo install expo-font expo-linking
npx expo install expo-constants
npx expo-doctor                                                3 times; ends at 19 of 20
npx expo config --type introspect                              Android permissions, before and after eas init
npx eas-cli@27.5.0 whoami / config                             config: the development profile is valid
mobile tsc, eslint, jest                                       after each dependency change: exit 0, 167 of 167
pnpm typecheck                                                 exit 0
pnpm lint                                                      exit 0
pnpm test                                                      exit 1: 2 mobile timeouts (below), web not reached; 11.5 min
pnpm --filter @employee-saas/mobile test                       rerun: exit 0, 167 of 167, 9.6 s
pnpm --filter @employee-saas/web test                          exit 0, 178 of 178
```
**You ran:** `eas login`, `npx eas-cli@27.5.0 init`, `npx eas-cli@27.5.0 build --profile development --platform android`.

Nothing touched the dev database. No migration. Nothing on 4000 or 5173 was stopped or started by me.

## Test results
| Workspace | Before (2.8) | Now |
|---|---|---|
| shared | 312 | 312 |
| api | 1178 | 1179 |
| mobile | 167 | 167 |
| web | 178 | 178 |
| **Total** | **1835** | **1836** |

**About the failed full run:** two mobile tests, in `site-picker.test.tsx` and `AttendanceCard.test.tsx`, hit Jest's 5-second
per-test limit. They didn't fail an assertion. Those two files took 23 s and 36 s, against 10 s for the whole mobile suite on
its own. The run overlapped with the phone install, when Expo was likely bundling. On a rerun the whole mobile suite passed in
9.6 s. pnpm stops at the first failing workspace, so web ran separately afterwards. To be exact: there's no single green
`pnpm test` run for this step, only green runs of every workspace.

**EAS cloud build:** succeeded on the first try. **Health check:** `expo-doctor` 19 of 20. The one left is the five deferred
version bumps.

**Android permissions** in the build (unchanged from 2.8): coarse and fine location, internet, vibrate, read/write external
storage, record audio, system alert window. Background location is listed with `tools:node="remove"`, which strips it.

## Your checklist
1. Install the APK from the build link on your phone. Android asks to allow installing from your browser, and Play Protect may
   warn ("Install anyway").
2. Restart your Expo terminal. It should say it's in development build mode. Open **Employee SaaS** (not Expo Go), and pick
   your PC or scan the QR code.
3. Log in as Alex and check that it behaves exactly as in Expo Go:
   - check in and out, and a site visit. The location prompt shows again (it's a new app to Android) and has **no "Allow all the time"**;
   - attach a photo or PDF as leave proof;
   - the notifications bell, and tapping a notification opens the right screen;
   - save a JS file or press `r`: it reloads with no rebuild;
   - shake the phone: the dev menu appears.
4. Press `s` in the Expo terminal and check that Expo Go still works too.
5. **Still pending from 2.8:** the check-in reminder test (needs a weekday before 09:00, or a schedule 2 minutes ahead), and
   both proof reminders. A reminder can be tried in the dev build, since it's the same app.

## Known limitations
- **Not tried on the phone yet.** "Runs exactly as in Expo Go" is your checklist item 3.
- **`RECORD_AUDIO`** is in the manifest, from `expo-image-picker`'s defaults (since 1.6). The app never records sound. Blocking it
  is one `app.json` line plus a rebuild. It's a question for you (below), not done here.
- **`apps/mobile/.npmrc`** says `node-linker=hoisted`, but pnpm only reads that at the workspace root, so it does nothing. It's
  harmless, but misleading. I left it alone, since nothing in 2.9a needed it.
- **Five SDK version bumps are deferred.** Suggested for 2.9b.
- **The dev build is a debug app.** It's for you, not for employees. A Play Store build is a separate profile and step.
- **Push, Firebase, `google-services.json`, FCM:** step 2.9b. `apps/mobile/google-services.json` isn't gitignored yet. Add that
  before you download it in 2.9b.
- **The full `pnpm test` is slow** (11.5 min) and timing-sensitive under load. Heavy work on the PC during it (Metro bundling)
  can time out the slower mobile tests.

## Questions for you
1. **Block `RECORD_AUDIO`?** The app never uses the microphone, and Play Store reviewers ask about it. I recommend blocking it
   in 2.9b, which needs a rebuild anyway.
2. **Delete `apps/mobile/.npmrc`?** It has no effect (see above). I recommend deleting it, with the `metro.config.js` comment
   that refers to it, in 2.9b.

## Exact next step
Run the checklist above. If the dev build works like Expo Go, **step 2.9b: push notifications**. Before it, finish §4.7 steps 3–4:
the Firebase project, `google-services.json` and the FCM V1 key. Those take calendar time, not code time.
