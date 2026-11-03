# Step 1.7 Report — Timezone check + in-app notifications (end of Phase 1)

Source prompt: `docs/prompts/step-1.7.md`. The sub-step by sub-step
checklist, including the full 22-row timezone findings table, is in
`docs/reports/step-1.7-progress.md`. This report summarises it.

## What was done

### 0. Architecture freeze
Added to CLAUDE.md "How to work" (#11): auth, tokens, users and companies
are frozen pending the platform migration design. Nothing in this step
changed them. `companies.timezone` is only ever **read**.

### 1.7a — Timezone date bug check (committed by the developer)
- One shared implementation of the date helpers in
  `packages/shared/src/dates.ts`, used by api, web and mobile:
  - `todayInTimezone`, `currentYearInTimezone`
  - `addDaysToIsoDate`, `daysBetweenIsoDates`
  - `toLocalIsoDate`, `isoDateToLocalDate`
  - `formatDate`, `formatDateTime`
- The API computes "today" and "this year" in `companies.timezone`
  (`apps/api/src/lib/companyTime.ts`).
- Real bugs fixed:
  - **Wrong leave year from 00:00 to 05:30 on 1 Jan in Colombo.**
    Balances, new employees, new leave types and the seed all used UTC's
    year instead of the company's.
  - **Mobile Home's "next upcoming leave"** still built "today" with
    `toISOString()`, a day behind until 05:30.
  - **The mobile picker's earliest allowed day** came from the phone's
    timezone instead of the company's.
  - **Calendar dates shown a day early west of UTC**, on web and mobile.
- Tests run under both `TZ=Asia/Colombo` and `TZ=UTC`. A mutation check
  (putting the old logic back) made them fail.

### 1.7b — Notifications API (committed by the developer)
- `GET /notifications`, `GET /notifications/unread-count`,
  `PATCH /notifications/:id/read` (idempotent), `PATCH /notifications/read-all`.
  - Each user sees only their own notifications, inside their own company.
  - Anything else returns 404.
- Every leave event writes the right notification for the right people.
  The full table is in `docs/api-phase1.md`. Gaps fixed:
  - Cancel wrote nothing.
  - The HR note was missing from document reviews.
  - Document reviews linked to the document instead of the leave request.
  - A manager with no login meant nobody was told.
  - An HR requester was asked to approve their own request.

### 1.7b follow-up (developer request)
- **Cancel recipients:**
  - Employee cancels → the approver(s) whose queue it was in at that
    moment. That's the manager at `PENDING_MANAGER`, or HR at `PENDING_HR`
    (also HR if the manager has no active login). The employee isn't
    notified, since they did it themselves.
  - System cancel (employee deactivation) → the employee, one notification
    per cancelled request, saying why.
  - Submit and cancel share `findCurrentApproverUserIds()`, so they always
    reach the same people.
- **Index `notifications(companyId, userId, createdAt)`**: migration
  `20261103120000_notifications_user_created_at_index`, applied to the dev
  and test databases.
  - The SQL came from `prisma migrate diff` between the old and new
    `schema.prisma`, not `prisma migrate dev`, because earlier hand-written
    migration SQL isn't in the Prisma schema and must not be dropped. The
    diff was exactly one `CREATE INDEX`.
  - Applied with `prisma migrate deploy` (no reset). Checked in
    `pg_indexes` on both databases.

### 1.7c — Notifications in the web portal and mobile app

**Shared** (`packages/shared/src/notifications.ts`):
- `formatUnreadBadge(count)`: "" (hide) / 1–9 / "9+".
- `getNotificationLeaveRequestId(n)`: which screen to open.
- Both apps use them, so they always agree.

**Web portal**
- **Bell in the top bar** (`components/NotificationBell.tsx`):
  - Unread badge ("9+" above 9), and an `aria-label` with the count.
  - Dropdown with the latest 5. The list only loads while it's open.
  - Loading, empty ("No notifications yet") and error-with-retry states.
  - "Mark all as read", and a "View all notifications" link.
  - Hidden for SUPER_ADMIN, who has no company and so no notifications.
- **Clicking a notification** marks it read (only if unread) and navigates
  to `/leave-requests/:id` straight away, without waiting for the PATCH
  (`lib/useOpenNotification.ts`).
- **Full page `/notifications`** (`routes/NotificationsPage.tsx`):
  All / Unread (n) tabs, paging (20 per page), mark all, and loading,
  empty and error states.
- **Refreshing** (`lib/notifications.ts`): the unread count refetches when
  the window regains focus and every 60 seconds. This query opts back in to
  focus-refetch, which is off app-wide. Every mark-read or mark-all
  invalidates all `["notifications", …]` queries, so the badge, dropdown
  and page update together. No websockets.
- **Times** are shown with the shared `formatDateTime` in the company's
  timezone.

**Mobile app**
- **Bell on the Home header** (`components/NotificationBell.tsx`): an
  Ionicons `notifications-outline` icon in the company colour, with an
  unread badge. It opens the notifications screen.
- **Tab icons** (developer request): Home `home`, Leave `calendar`,
  Profile `person`. The active tab shows the filled icon, the others the
  outline version, tinted with the company colour.
  - `@expo/vector-icons` was added with `npx expo install` (15.1.1,
    SDK-aligned), as approved by the developer.
  - Under Jest the real icons can't load their font ("Module … is missing
    from the asset registry"), so `__mocks__/@expo/vector-icons.js`
    renders the icon name as text instead, with testID `icon-<name>`. This
    is the same pattern as the existing `expo-secure-store` and
    date-picker mocks.
- **Notifications screen** (`app/notifications.tsx`): a root-stack screen
  with a back button.
  - Pull-to-refresh, and loads more as you scroll (`useInfiniteQuery`, 20
    per page).
  - Unread dot plus bold title; screen readers hear "…, unread".
  - "Mark all as read".
  - Loading, empty ("No notifications yet") and error-with-retry states.
- **Tapping a notification** marks it read (only if unread) and runs
  `router.push("/leave/<id>")`.
  - The Leave stack now sets `unstable_settings.initialRouteName = "index"`.
    When a notification opens a request before the Leave tab was ever
    visited, Back goes to the leave list rather than nowhere.
- **Refreshing:**
  - When the app comes back to the foreground: `useAppStateFocus()` in the
    root layout tells TanStack Query that `AppState` "active" counts as
    focus.
  - Whenever Home gains focus (`useFocusEffect`).
  - On Home's pull-to-refresh.
  - No push notifications, no background polling.
- **Times** use the shared `formatDateTime` in the company's timezone.

**New concepts, briefly:**
- **Polling instead of push.** The apps ask "anything new?" at sensible
  moments (focus, foreground, every 60s on web) instead of the server
  pushing updates. It's simpler and good enough for Phase 1.
- **Query invalidation.** After a change, TanStack Query is told "these
  cached answers are stale", and it refetches whichever ones are on screen.
- **Infinite query.** A list that fetches page 2, 3, … as you scroll, and
  keeps all loaded pages in one list.

### Test-infrastructure fix (mobile)
- **The problem.** Running a single mobile test file took about **4m40s**
  even though its tests finished in seconds. `login.test.tsx` did the same
  before this step. React Query leaves a 5-minute cache clean-up timer
  (`gcTime`) for every query and mutation, and Jest waits for pending timers
  before exiting. In the full suite, Jest force-killed the worker instead,
  which was the old "A worker process has failed to exit gracefully" warning.
- **The fix.** New `apps/mobile/jest.setup.ts`, registered as
  `setupFilesAfterEnv` in `package.json`. In tests only, it gives the shared
  `queryClient` `gcTime: Infinity` (no timer is ever scheduled) and clears
  it after each test, which also stops one test's cache leaking into the
  next. The app's real defaults in `lib/queryClient.ts` are unchanged.
- **Results.** `login.test.tsx` went from 4m40s to 7s. The full mobile suite
  takes about 18s, and the warning is gone.
- I tried `queryClient.clear()` alone first. It wasn't enough: the files
  still took 4m40s.

## Files changed in this session's uncommitted work (1.7b follow-up + 1.7c)
- **API:**
  - `apps/api/prisma/schema.prisma`
  - `apps/api/prisma/migrations/20261103120000_notifications_user_created_at_index/migration.sql`
  - `apps/api/src/modules/leaveRequests/leaveRequests.service.ts`
  - `apps/api/src/modules/leaveRequests/leaveDecisions.service.ts`
  - `apps/api/src/modules/employees/employees.service.ts`
  - `apps/api/src/modules/notifications/notifications.test.ts`
- **Shared:**
  - `packages/shared/src/notifications.ts`
  - `packages/shared/src/notifications.test.ts` (new)
- **Web:**
  - New:
    - `src/lib/notifications.ts`
    - `src/lib/useOpenNotification.ts`
    - `src/components/NotificationBell.tsx` + `.test.tsx`
    - `src/components/NotificationItem.tsx`
    - `src/routes/NotificationsPage.tsx` + `.test.tsx`
  - Edited: `src/App.tsx`, `src/layout/AppShell.tsx`, `src/strings.ts`
- **Mobile:**
  - New:
    - `src/lib/notifications.ts`
    - `src/components/NotificationBell.tsx`
    - `src/app/notifications.tsx`
    - `src/__tests__/app/notifications.test.tsx`
    - `jest.setup.ts`
  - Edited:
    - `src/app/_layout.tsx`
    - `src/app/(tabs)/_layout.tsx`
    - `src/app/(tabs)/index.tsx`
    - `src/app/(tabs)/leave/_layout.tsx`
    - `src/strings.ts`
    - `package.json` (Jest `setupFilesAfterEnv`, and `@expo/vector-icons`)
    - `components/NotificationBell.tsx` and `(tabs)/_layout.tsx` (icons)
  - New mock: `__mocks__/@expo/vector-icons.js`
- `pnpm-lock.yaml`
- **Docs:**
  - `docs/api-phase1.md`
  - `docs/database-schema.md`
  - `docs/reports/step-1.7-progress.md`
  - `docs/reports/step-1.7.md` (this file)
  - `CLAUDE.md`

## Commands run (this session, after 1.7b was committed)
```
npx prisma migrate status                                   # dev + test: up to date
npx prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script
                                                           # -> exactly one CREATE INDEX
npx prisma migrate deploy                                   # dev DB (employee_saas)
npx dotenv -e .env.test -- npx prisma migrate deploy        # test DB (employee_saas_test)
docker compose exec postgres psql ... pg_indexes            # index present on both; hand-written indexes intact
npx prisma generate
CI=1 timeout 75 npx expo start --offline                    # only to regenerate typed routes (.expo/types/router.d.ts) for /notifications; stopped
pnpm typecheck / pnpm lint                                  # all 4 workspaces clean
pnpm test   (x3 full workspace runs)                        # 1st: 3 mobile failures (see below); 2nd and 3rd: all green
npx expo export --platform android                          # "Android Bundled" (1306 modules); dist/ deleted
```

## Test results
- **shared 28/28.** That's 26 date tests plus 2 new (badge text, notification target).
- **api 180/180.**
  - The notifications module has 21 tests: 7 endpoint tests and 14 event tests.
  - The old "cancel → employee" test was replaced by 4: manager queue, HR
    queue after the manager step, HR requester, and the deactivation
    cascade.
- **web 26/26** (18 before + 8 new).
  - Bell: badge count, "9+", hidden at 0 with the empty state, click →
    mark read → navigate, already-read → no PATCH, mark all clears the
    badge, error state.
  - Page: paging plus the unread filter going back to page 1.
- **mobile 29/29** (21 before + 8 new).
  - List rendering with Colombo-time timestamps, tap → mark read →
    navigate, already-read → no PATCH, mark all, empty state, error state.
  - Bell: "9+" badge and opens the screen; badge hidden at 0.
- **Mutation checks** (the old logic put back for a moment, then restored):
  - 1.7a timezone: 4/8 integration tests failed.
  - 1.7b own-only filter: 3 endpoint tests failed.
- **Typecheck and lint** clean in all 4 workspaces.
- **`npx expo export --platform android`**: bundled, 1306 modules; after
  the icon change, 1383 modules (the icon set and font are now included).

**First full run after the Jest config change: 3 mobile tests failed.** The
first test in `apply.test.tsx` and in `notifications.test.tsx` hit Jest's 5s
test timeout; both files took about 58s instead of the usual few seconds.
A second test in `notifications.test.tsx` then failed on a missing
`router.push` call, probably a knock-on effect of the timeout.

My best explanation, unconfirmed: changing the Jest config invalidates its
transform cache, so this was a cold-cache run competing for CPU with the
api and web suites. The next two full runs were completely green, with
mobile taking about 18s. If you see this again on a warm cache, tell me.

**`leaveDecisions.test.ts` intermittent failure:** it did **not** appear in
any run this session. That's 4 full API runs since you asked me to watch for
it, plus the module runs.

## Known limitations
- **No real-time updates.** Web polls every 60s plus on focus; mobile
  refreshes on foreground and when Home is focused. This is by design for
  Phase 1; push and websockets are Phase 2.
- **System cancel (deactivation) doesn't notify the approvers.** The request
  just leaves their pending list. You asked only for the employee to be
  notified here.
- **The deactivated employee can't read their cancellation notice** (their
  login is deactivated in the same transaction). They'll see it if the
  profile is reactivated.
- **Typed routes** (`.expo/types/router.d.ts`, gitignored) are regenerated by
  `expo start`. A fresh clone gets the `/notifications` route type the first
  time the dev server runs.
- Notification text is stored in English at write time. Translated
  notifications would need type + parameters instead (a later phase).

## Real-device checklist

Setup: API + web running (`pnpm dev`) and the Expo app on your phone, as in
the README's "Run the app on your phone". Seeded logins, password `Passw0rd!`,
company code `ACME`:
- **employee (phone):** `alex@acme.test` / `ACM-EMP-003`. Reports to the manager.
- **manager (web):** `manager@acme.test`
- **HR (web):** `hr@acme.test`

Workflow is the default `MANAGER_ONLY`.

**A. Apply → manager sees it → approve → employee opens it**
1. Web: log in as the manager. Note the bell badge count (it may be empty).
2. Phone: log in as Alex. **Leave → Apply for leave**: annual leave, a
   future weekday, then submit.
3. Web (manager): within 60 seconds, or straight away if you click away
   from the browser and back, the bell count goes **up by 1**. Open the
   bell: "New leave request awaiting your approval", "Alex … requested 1
   day(s) of leave (…)".
4. Click it. The leave request detail page opens and the badge goes down
   by 1. Approve it, adding a note (e.g. "Enjoy").
5. Phone: go to the Home tab (or put the app in the background and bring
   it back). The bell icon in the Home header shows a badge.
6. Tap the bell, then the notifications list. "Your leave request was approved"
   should show your note and a time in Sri Lanka time. Pull down to refresh
   works.
7. Tap the notification. It opens that leave request's detail screen.
   **Back** goes to the Leave list. Go back to Home: the badge is gone.
8. Optional: apply again, then **cancel** it on the phone. On web, the
   manager gets "Leave request cancelled". Alex gets nothing, since they
   cancelled it themselves.

**B. HR reviews a sick-leave document → employee gets the HR note**
1. Phone (Alex): apply for **sick leave** (e.g. yesterday) and upload a
   proof photo or PDF.
2. Web: log in as HR. Open that leave request and mark the document
   **Info required**, with the note "Please add the doctor's stamp".
3. Phone: bring the app to the foreground, or open Home. The badge appears.
   Open notifications: "More information needed for your sick leave
   document", with body `… HR note: "Please add the doctor's stamp"`.
4. Tap it. The leave request detail screen opens, showing the document as
   "Info required" with the note, and the "Upload another file" button.
5. Tap **Mark all as read**. The unread dots disappear, and the badge is
   gone on Home.

**C. Quick extras**
- Web: the full page at **View all notifications** has All / Unread tabs
  and paging (after 20+ notifications).
- Web as HR, with 10+ unread: the badge shows **9+**.
- Log in as the platform SUPER_ADMIN: there is no bell, which is correct
  since there's no company.
- Phone: the tab bar shows Home / Leave / Profile icons. The active tab's
  icon is filled and in the company colour; the others are outlines.

## Device test result
**Passed on 2026-11-03** (developer, real Android device + web portal):
- tab and bell icons
- the leave notification flow: apply on the phone → manager's bell on web
  → approve → the employee's notification opens the request
- the HR note on a document-review notification
- the cancel notification reaching the manager

**Step 1.7 is complete, and with it Phase 1 (Core Employee Management).**
CLAUDE.md is updated to match.

## Next step
Phase 1 is finished. The next phase hasn't been planned yet, so there's
no next step to start. Plan the next phase first; `docs/proposal.md` has
the full requirements. The architecture freeze on auth, tokens, users and
companies (CLAUDE.md "How to work" #11) still applies until the platform
migration design is approved.
