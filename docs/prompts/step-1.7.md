# STEP 1.7 — Timezone check + in-app notifications (end of Phase 1)

Read CLAUDE.md, docs/architecture.md, docs/api-phase1.md and docs/reports/step-1.6.md first.

Work in the sub-steps below (1.7a → 1.7c).
- Keep a checklist in `docs/reports/step-1.7-progress.md` so a cleared or interrupted session can continue from it.
- Never commit or push; at the end of each sub-step give me the changed files, what to test, and suggested commit messages.

## 0. Architecture freeze (read first)
The team is designing a central identity + subscription platform. Until it is approved:
- Do NOT change authentication, tokens, login endpoints, the `users` table or the `companies` table.
- Add this rule to CLAUDE.md under "How to work": "Auth, tokens, users and companies are frozen pending the platform migration design. Do not change them without asking."

If anything in this step seems to need one of those changes, stop and ask me.

## 1.7a — Timezone date bug check (web + API)
The mobile app had a bug: dates built with `toISOString()` shifted by a day in UTC+5:30 (Sri Lanka).
1. Search apps/web, apps/api and packages/shared for the same pattern: `toISOString().slice(0, 10)`, `new Date("YYYY-MM-DD")` parsed as UTC, `getDate()`/`setDate()` on UTC dates, "today" computed in the server's timezone instead of the company's.
2. List every place you find, and say whether it is a real bug or safe (e.g. timestamps that are meant to be UTC).
3. Fix the real bugs.
   - Move the local-date helpers (today in a timezone, add days, format) into packages/shared, so web, mobile and API use one implementation.
   - The API must compute "today" in the company's timezone (`companies.timezone`), not the server's.
4. Add tests that run with `TZ=Asia/Colombo` and also with `TZ=UTC`, covering:
   - a date picked at local midnight
   - "today" just after local midnight (e.g. 00:15 in Colombo = 18:45 UTC the day before)
   - the leave day calculation across that boundary
5. Stop and report before 1.7b.

## 1.7b — Notifications API
Notification rows are already written by `createNotification()` (Step 1.4). Now expose them.

**Endpoints** (from docs/api-phase1.md):
- `GET /notifications` — own only, newest first, paginated, optional `unreadOnly=true`
- `GET /notifications/unread-count`
- `PATCH /notifications/:id/read` — own only, idempotent
- `PATCH /notifications/read-all`

**Rules:**
- A user only ever sees their own notifications, inside their own company.
- Another user's or another company's notification → 404.

**Check that every event writes the right notification:**
- leave submitted → current approver(s): the manager, or HR when the request is PENDING_HR or the employee has no manager
- MANAGER step approved under MANAGER_THEN_HR → HR
- approved / rejected / revoked / cancelled → the employee
- document reviewed (accepted / rejected / info required) → the employee, including the HR note
- Each notification has `type`, a short `title`, a `body`, and `relatedEntityType` + `relatedEntityId`, so the apps can open the right screen.

Add any missing ones. Don't add email or push notifications (Phase 2).

**Tests:**
- own-only and cross-tenant 404
- unread count
- mark read is idempotent; read-all only affects own rows
- pagination
- each event above creates the expected notification for the expected user, and nobody else

## 1.7c — Notifications in the web portal and the mobile app

**Web portal:**
- A bell in the top bar with an unread badge (e.g. "9+" above 9).
- Opening it shows the latest notifications. Clicking one marks it read and goes to the related screen (leave request detail, etc.).
- "Mark all as read".
- A full notifications page with paging and an unread filter.
- Refresh the unread count with TanStack Query: on window focus and every 60 seconds. No websockets in Phase 1.

**Mobile app:**
- A notifications screen, reachable from a bell icon on the Home screen header with an unread badge.
- Pull-to-refresh. Tapping a notification marks it read and opens the related screen (leave request detail).
- "Mark all as read".
- Refresh the unread count when the app comes to the foreground and when Home is focused. No push notifications in Phase 1.

**Both:**
- Strings go in the strings files.
- Show loading, empty ("No notifications yet") and error states.
- Dates are shown in local time using the shared helpers from 1.7a.

**Tests:**
- web: badge count, mark read, mark all
- mobile: list rendering, the tap → mark read → navigate flow
- Run the whole workspace typecheck, lint and test, plus `npx expo export --platform android` (then delete dist/).

## Finish
- Write docs/reports/step-1.7.md, including a real-device checklist I can follow:
  - employee applies on the phone → manager sees the bell count go up on web → manager approves → employee sees the notification on the phone and tapping it opens the request
  - HR reviews a sick-leave document → employee gets the notification with the HR note
- Update the CLAUDE.md status: Phase 1 complete once I confirm the device test.
- Give me suggested commits split by concern (shared date helpers / API / web / mobile / docs), with each `git add` command on ONE line (I use PowerShell, so no `\` line continuations).
