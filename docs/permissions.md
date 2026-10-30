# Permissions — Phase 1 role × action matrix

Legend: ✅ allowed · 🔶 allowed, scoped (see note) · ❌ not allowed.

Enforcement happens in the API (service layer), not the UI. "Deny by default"
means any action not explicitly listed as ✅/🔶 for a role returns `403
FORBIDDEN`. The UI only hides controls the user can't use — it is not a
security boundary.

`SUPER_ADMIN` is a platform-team role with no `companyId` of its own; it
manages companies as *accounts*, not as a company member, and is explicitly
**excluded** from salary and medical-document data per CLAUDE.md.

## Company & settings

| Action | SUPER_ADMIN | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| Create a new company (tenant) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Suspend / reactivate a company | ✅ | ❌ | ❌ | ❌ | ❌ |
| View company list (platform-wide) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Edit own company profile/branding | ❌ | ✅ | ❌ | ❌ | ❌ |
| Edit company settings (leave workflow, GPS defaults, employee ID format, enabled modules) | ❌ | ✅ | ❌ | ❌ | ❌ |
| View own company settings | ❌ | ✅ | ✅ | 🔶 read-only | 🔶 read-only |

## Users & roles

| Action | SUPER_ADMIN | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| Create a user / assign a role within own company | ❌ | ✅ | ❌ | ❌ | ❌ |
| Deactivate / reactivate a user in own company | ❌ | ✅ | ❌ | ❌ | ❌ |
| Reset another user's password | ❌ | ✅ | ❌ | ❌ | ❌ |
| Change own password | ❌ | ✅ | ✅ | ✅ | ✅ |
| View user accounts in own company | ❌ | ✅ | 🔶 view only | ❌ | ❌ |

## Departments & designations

| Action | SUPER_ADMIN | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| Create / edit / delete departments & designations | ❌ | ✅ | ✅ | ❌ | ❌ |
| View departments & designations | ❌ | ✅ | ✅ | ✅ | ✅ |

## Employees

| Action | SUPER_ADMIN | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| Create an employee profile | ❌ | ✅ | ✅ | ❌ | ❌ |
| Edit any employee profile in own company | ❌ | ✅ | ✅ | ❌ | ❌ |
| Edit own profile (contact info, photo only) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Deactivate an employee | ❌ | ✅ | ✅ | ❌ | ❌ |
| View any employee in own company | ❌ | ✅ | ✅ | 🔶 own team only | ❌ |
| View own profile | ❌ | ✅ | ✅ | ✅ | ✅ |
| Assign / change an employee's manager | ❌ | ✅ | ✅ | ❌ | ❌ |

"Own team" for a Manager = employees whose `managerId` (directly or, if we
later support multi-level rollups, transitively) points to the manager's own
`employeeId`. Phase 1 ships direct reports only.

## Leave types & policies

| Action | SUPER_ADMIN | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| Create / edit / delete leave types | ❌ | ✅ | ✅ | ❌ | ❌ |
| View leave types | ❌ | ✅ | ✅ | ✅ | ✅ |
| Manage company holidays | ❌ | ✅ | ✅ | ❌ | ❌ |

## Leave balances

| Action | SUPER_ADMIN | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| Manually adjust an employee's balance (audited) | ❌ | ✅ | ✅ | ❌ | ❌ |
| View any employee's balance in own company | ❌ | ✅ | ✅ | 🔶 own team only | ❌ |
| View own balance | ❌ | ✅ | ✅ | ✅ | ✅ |

## Leave requests

| Action | SUPER_ADMIN | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| Submit a leave request | ❌ | 🔶 for self | 🔶 for self | 🔶 for self | ✅ for self |
| Cancel own pending request | ❌ | ✅ | ✅ | ✅ | ✅ |
| View own requests & history | ❌ | ✅ | ✅ | ✅ | ✅ |
| View requests for own team (direct reports) | ❌ | ❌ | ❌ | ✅ | ❌ |
| View all requests in own company | ❌ | ✅ | ✅ | ❌ | ❌ |
| Approve / reject at the MANAGER step for a direct report | ❌ | ❌ | ❌ | ✅ | ❌ |
| Approve / reject at the HR step (`MANAGER_THEN_HR` workflow, or any request whose employee has no manager) | ❌ | ❌ | ✅ | ❌ | ❌ |
| Approve / reject a request at the MANAGER step as a fallback/override | ❌ | ❌ | ✅ | ❌ | ❌ |
| Approve / reject one's own leave request, at any step | ❌ | ❌ | ❌ | ❌ | ❌ |
| Re-decide an already-decided step | ❌ | ❌ | ❌ | ❌ | ❌ |
| Revoke an already-approved future leave (decrements `usedDays`) | ❌ | ✅ | ✅ | ❌ | ❌ |

A decision step is idempotent (CLAUDE.md): once a `leave_approvals` row
exists for a given step, no role — including HR/Admin — can change that
decision through the approve/reject endpoint; a correction requires either
the revoke action above (for an approved request) or a documented balance
adjustment, both separately audited. **Nobody may decide their own request**
— this check runs regardless of role or step, so even HR acting as a
fallback approver cannot approve/reject a request where they are the
requester. HR's "fallback/override" at the MANAGER step exists for when the
assigned manager is unavailable; it still writes a normal `leave_approvals`
row (`step: MANAGER`, `approverUserId` = the HR user) and is auditable like
any other decision — and under `MANAGER_THEN_HR`, that fallback decision is
**final**: it does not go on to create a `PENDING_HR` state, since routing it
back to HR a second time would be circular.

## Sick leave documents

| Action | SUPER_ADMIN | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| Upload a document to own leave request | ❌ | 🔶 for self | 🔶 for self | 🔶 for self | ✅ for self |
| Review / set document status (Accepted/Rejected/Info Required) | ❌ | ❌ | ✅ | ❌ | ❌ |
| View / download own document | ❌ | ✅ | ✅ | ✅ | ✅ |
| View / download a direct report's document | ❌ | ❌ | ❌ | ❌ | ❌ |
| View / download any document in own company | ❌ | ✅ | ✅ | ❌ | ❌ |

Medical documents are deliberately **not** visible to Managers (only the
leave *decision* is their concern, not the proof) and **never** visible to
`SUPER_ADMIN`, per CLAUDE.md.

## Notifications

| Action | SUPER_ADMIN | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| View / mark-read own notifications | ❌ | ✅ | ✅ | ✅ | ✅ |

## Audit logs

| Action | SUPER_ADMIN | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| View audit log for own company | ❌ | ✅ | 🔶 leave/balance actions only | ❌ | ❌ |
| View audit log across companies | ✅ | ❌ | ❌ | ❌ | ❌ |

## Salary (defined now for completeness; endpoints arrive in a later phase)

| Action | SUPER_ADMIN | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| View any salary/payslip in own company | ❌ | 🔶 if company policy allows | 🔶 if company policy allows | ❌ | ❌ |
| View own payslip | ❌ | ✅ | ✅ | ✅ | ✅ |

`SUPER_ADMIN` is hard-denied here regardless of company settings — this is a
platform-level rule, not a per-company toggle.
