# STEP 1.5 — Web portal (HR, Manager, Company Admin, Super Admin)

Read CLAUDE.md, docs/architecture.md, docs/permissions.md, docs/api-phase1.md and docs/reports/step-1.4.md first.

## 0. Before starting
1. Add this rule to CLAUDE.md under "How to work": "Never truncate, reset or reseed the DEV database without asking the developer first. The test database may be reset freely." Commit it.
2. This step is large. Build it in the sub-steps below (1.5a → 1.5d).
   - Commit after each sub-step.
   - Keep a checklist in `docs/reports/step-1.5-progress.md`, so that if the session is cleared or interrupted, a new session can read that file and continue from the right place.

## Tech (apps/web)
- React + TypeScript + Vite, React Router, TanStack Query, Tailwind + shadcn/ui, react-hook-form + Zod (reuse the schemas from packages/shared, do not redefine them).
- Vite dev proxy: `/api` → the API on port 4000, so cookies are same-origin.
- One API client module:
  - fetch with credentials
  - on 401, call /auth/refresh once and retry the request; only one refresh may run at a time even when several requests fail together; if the refresh fails, go to the login page
  - map the API error shape to toasts and to form field errors
- All UI text kept in one strings file (English for now), so Sinhala/Tamil can be added later without touching components.
- Dates shown in the company's timezone, format like `31 Oct 2026`.
- Every data screen has a loading state (skeleton), an empty state, and an error state with a retry button. Destructive actions need a confirmation dialog. Use toasts for success and failure.
- Layout works on desktop and tablet widths.
- Branding: apply the company's primary colour (from company settings/profile) as a CSS variable. Show the company name in the top bar. Show the logo when one exists (logo upload comes later).
- Route guards and role-based menus are for UX only; the API stays the real security boundary.

## 1.5a — Auth + app shell
- `/login`: company code, employee code or email, password. Show a generic error message on failure.
- Forced change-password screen when `mustChangePassword` is true; nothing else is reachable until the password is changed.
- `/platform/login` for SUPER_ADMIN.
- App shell: sidebar menu by role, top bar (company name, user menu, logout), and a 404 page.
- Guards: logged-out users go to login; a wrong role sees a "not allowed" page.

## 1.5b — People & organisation (HR, COMPANY_ADMIN)
- **Employees list:** search by name/code, filter by department/status, pagination.
- **Create employee form**, with an option to create a login (role EMPLOYEE / MANAGER / HR). After creation, show the temporary password ONCE in a dialog with a copy button and the warning "it will not be shown again".
- **Employee detail page:**
  - profile, manager, department, designation
  - leave balances (available / pending / used per type)
  - leave history
  - edit and deactivate (with confirmation)
  - reset password (shows the temporary password once)
- Departments and designations: simple CRUD tables. Show the API's 409 error clearly when an item is still in use.
- Users (COMPANY_ADMIN): list, change role, activate/deactivate, reset password. Show the "last admin" error clearly.

## 1.5c — Leave (HR, MANAGER, and everyone with an employee profile)
- **HR leave requests page:**
  - tabs: Pending / Approved / Rejected / All
  - filters: employee, leave type, date range
  - a "Proof missing / overdue" filter based on proofStatus and proofDueAt
- **Request detail (drawer or page):**
  - dates, half-day flags, total days, reason
  - employee's current balance for that type, and the balance after approval
  - approval history (`leave_approvals`)
  - documents: HR can download and review (Accepted / Rejected / Info required + note); managers never see documents
  - Approve / Reject with an optional note, shown only when the current user is allowed to decide this step (never on their own request)
  - Revoke for approved future leave (HR / COMPANY_ADMIN), with a confirmation dialog and a note
- **Manager:**
  - "My team" list (direct reports)
  - team leave requests, with approve/reject at the MANAGER step
  - no access to documents
- **"My leave"** (for every logged-in user who has an employee profile: HR and managers are employees too):
  - balances
  - apply for leave (leave type, dates, half-day flags, reason), showing the calculated total days before submitting (add a small API endpoint for this calculation if needed, with tests)
  - own history, cancel a pending request
  - upload a document for a sick-leave request
- Leave types (HR / COMPANY_ADMIN): CRUD, including requiresProof and allowPastDates.
- Balance adjustment dialog on the employee detail page (reason required).
- Holidays: list, add, delete.

## 1.5d — Settings, dashboards, Super Admin
- **Company settings (COMPANY_ADMIN):**
  - company profile and primary colour
  - leave approval workflow
  - sick leave proof deadline
  - working days editor (each weekday: Full / Half / Off)
  - employee ID prefix
- **Dashboards:**
  - HR / COMPANY_ADMIN: total active employees, pending leave requests, proofs missing/overdue, employees on leave today
  - MANAGER: team pending requests, team members on leave today
  - If the API has no summary endpoint, add a role-scoped `GET /dashboard/summary` with tests (including cross-tenant and manager-scope tests).
- **Super Admin:**
  - companies list
  - create company (show the first admin's temporary password once)
  - suspend/reactivate with confirmation

## Tests
- Vitest + React Testing Library + MSW for:
  - login form (success and generic error)
  - refresh-once-then-redirect logic in the API client (including two parallel 401s → only one refresh call)
  - route guard by role
  - approve/reject buttons hidden on your own request and for a manager at the HR step
  - temporary password dialog shown once
  - leave apply form validation
- Playwright: one end-to-end smoke test against the dev API — employee applies for leave → manager approves → employee sees APPROVED and the updated balance. If the Playwright browser download fails on this machine, skip it, say so in the report, and do not block the step.
- API tests for any new endpoints.
- Run all tests, typecheck and lint for the whole workspace.

## Finish
- Update README with how to run the web app, the URL, and which seeded login to use for each role.
- Update the CLAUDE.md status, commit, and try to push (if push fails, tell me and continue).
- Write the report to docs/reports/step-1.5.md as described in CLAUDE.md. Include a short "How to try it" list: which login to use and what to click, for each role.
