# Step 2.0 Report — Phase 2 design (Attendance & Site Management)

Source prompt: `docs/prompts/step-2.0.md`. **This is a design-only step.**
The only code change is the prerequisite test-script fix. There are no
migrations and no application code. **I'm waiting for your approval before
step 2.1.**

## What was done

### Prerequisite: stable root `pnpm test`
- **Change:** in the root `package.json`, `"test": "pnpm -r test"` is now
  `"pnpm -r --workspace-concurrency=1 test"`.
  - Before, pnpm ran all four workspaces' tests at the same time. Each
    test runner grabs the CPU it can, and the API suite's DB-heavy tests
    timed out when they had to share it. That happened twice in step 1.7.
  - Now pnpm runs the workspaces one after another (shared → api → mobile →
    web, in dependency order).
  - Inside the API suite, files were already one at a time
    (`fileParallelism: false`), because of the shared test DB.
- **Cost:** a full run takes about 2m20s. That's about the time the API
  suite needs alone, plus about 35 s for the rest.
- **Proof:** three full runs in a row, all green:

  | Run | Exit | Time | shared | api | mobile | web |
  |---|---|---|---|---|---|---|
  | 1 | 0 | 141 s | 28/28 | 180/180 | 29/29 | 26/26 |
  | 2 | 0 | 146 s | 28/28 | 180/180 | 29/29 | 26/26 |
  | 3 | 0 | 137 s | 28/28 | 180/180 | 29/29 | 26/26 |

- Recorded in the CLAUDE.md "Commands" section.

### Phase 2 design docs (new folder `docs/phase2/`)
1. **`database-schema-phase2.md`**: the new tables and their constraints,
   indexes and a Mermaid ER diagram:
   - `sites`, `employee_schedules`, `attendance_records`, `site_visits`,
     `attendance_corrections`, `tasks`
   - `push_devices`, `user_notification_settings`, `push_messages`
   - `job_runs`

   Also:
   - 11 new `company_settings` columns.
   - `notifications.dedupeKey`.
   - Cross-module effects, e.g. approving leave flips an ABSENT day to
     ON_LEAVE.
   - Nothing changes on `users`, `companies` or `refresh_tokens`.
2. **`api-phase2.md`**: about 45 endpoints in the Phase 1 style, plus new
   notification events and new error codes.
3. **`permissions-phase2.md`**: the role × action matrix. SUPER_ADMIN has
   no access to any Phase 2 data.
4. **`architecture-phase2.md`**:
   - module gating;
   - attendance rules and an edge-case table (night shifts, holiday/leave
     check-ins, double check-in, check-out without check-in, offline, lost
     responses);
   - GPS reject/flag rules;
   - privacy: what employees are told, who sees what, retention;
   - push design (outbox, tickets, receipts, opt-out, and your exact
     Android/EAS/FCM setup steps);
   - the job runner;
   - reports;
   - identity-migration compatibility.
5. **`plan.md`**: steps 2.1–2.12, each with scope, "try it" and risks,
   plus **24 open questions**.

## Key design decisions (short)
- **Attendance:** one record per employee per work date, with one
  check-in/out pair.
  - A unique index makes a double check-in impossible.
  - `clientRequestId` makes retries safe.
- **Work date:** the date the shift *starts*, so night shifts work.
  - "End of day" means the end of that shift plus `autoCheckoutAfterMinutes`
    (default 4 h), not midnight.
- **GPS:** only collected at GPS-required sites, only on tap, foreground
  only.
  - **Rejected at check-in:** clearly outside the radius, no location, or a
    mock location.
  - **Allowed but flagged:** poor accuracy when the uncertainty circle
    overlaps the site, and every GPS problem at check-out. Blocking a
    check-out would only leave the record open.
- **Raw coordinates:** visible to the employee and HR/Admin only, never in
  CSV, and erased after 90 days. Distance and "within radius" are kept.
- **Job runner:** in-house, with no new infrastructure or library:
  - a `job_runs` claim row (`INSERT … ON CONFLICT DO NOTHING`), so only one
    instance runs each job;
  - idempotent work, using unique constraints and the notification
    `dedupeKey`;
  - `SKIP LOCKED` for the push queue;
  - a separate `worker.ts` process.
- **Push:** an outbox written in the same transaction as the notification,
  then:
  - plain `fetch` to Expo's API;
  - receipts checked after 15 min;
  - dead tokens disabled;
  - per-category opt-out;
  - no sensitive text on the lock screen.

## New concepts (plain language)
- **Workspace concurrency:** how many workspaces pnpm runs at the same
  time. 1 means "one after another".
- **Outbox pattern:** save "this push must be sent" in the same database
  transaction as the event. A worker sends it afterwards, so a rolled-back
  event never sends a push.
- **Idempotent job:** running it twice gives the same result as running it
  once. That's what makes retries and two servers safe.
- **`SKIP LOCKED`:** lets two workers take items from one queue table
  without both taking the same row.
- **Development build:** your own build of the Expo app with native modules
  such as push. Android push no longer works in Expo Go.

## Files changed
- `package.json` (root `test` script)
- `CLAUDE.md` (Commands: note on the sequential test run)
- New:
  - `docs/phase2/database-schema-phase2.md`
  - `docs/phase2/api-phase2.md`
  - `docs/phase2/permissions-phase2.md`
  - `docs/phase2/architecture-phase2.md`
  - `docs/phase2/plan.md`
  - `docs/reports/step-2.0.md` (this file)
- `docs/prompts/step-2.0.md` was already untracked. I didn't change it.

## Commands run
```
pnpm test        (x3, sequential, after the script change) -> all green, see table
pnpm typecheck   -> all workspaces clean
pnpm lint        -> all workspaces clean
```
There were no DB changes and no migrations. The dev database wasn't
touched.

## Test results
- See the table above: 3/3 full runs green, 263 tests each.
- No new tests in this step. It's docs plus a script change.

## Known limitations
- `docs/architecture/platform.md` (central identity) doesn't exist yet.
  Phase 2's compatibility rules are in architecture-phase2 §7, and they'll
  need checking against that design when it's written.
- The design depends on the answers to the open questions. Q1, Q2, Q4, Q6
  and Q13 are the ones most likely to change a table or a flow.
- The EAS dev build with our pnpm monorepo is untested. It's isolated as
  step 2.9a, because it's the riskiest unknown of the phase.

## Open questions
The 24 questions are at the end of `docs/phase2/plan.md`. The most
important ones:
- **Q1:** are Phase 2 modules off by default?
- **Q2:** does a site check-in start the attendance day?
- **Q4:** is offline check-in needed?
- **Q6:** should location be collected at sites that don't require GPS?
- **Q13:** are Prisma back-relation lines in the `Company`/`User` model
  blocks OK under the freeze? They generate no SQL.
- **Q20/Q21/Q23:** do you approve the in-house job runner, plain-fetch push,
  and the four Expo libraries?

## Suggested commit (you run it)
```
chore: run workspace tests sequentially; docs: phase 2 design (attendance, sites, tasks, push, jobs)
```
Or split it:
- `chore: run workspace tests one at a time to stop API timeouts` for
  `package.json` + `CLAUDE.md`
- `docs: phase 2 design and plan` for `docs/phase2/` + this report

## Exact next step
**Wait for your answers and approval.** After that, step **2.1
Foundations**: module switches, schedule settings, the shared
time/haversine helpers and the notification `dedupeKey`.
