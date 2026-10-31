import type { Role } from "@employee-saas/shared";
import { strings } from "../strings";

export type NavItem = { to: string; label: string; roles: Role[] };

// Extend this list as each sub-step of Step 1.5 adds real pages - an entry
// here must point at a route that actually exists (no dead links).
export const NAV_ITEMS: NavItem[] = [
  {
    to: "/",
    label: strings.nav.dashboard,
    roles: ["SUPER_ADMIN", "COMPANY_ADMIN", "HR", "MANAGER", "EMPLOYEE"],
  },
  {
    to: "/employees",
    label: strings.nav.employees,
    roles: ["COMPANY_ADMIN", "HR", "MANAGER"],
  },
  {
    to: "/users",
    label: strings.nav.users,
    roles: ["COMPANY_ADMIN", "HR"],
  },
  {
    to: "/departments",
    label: strings.nav.departments,
    roles: ["COMPANY_ADMIN", "HR"],
  },
  {
    to: "/designations",
    label: strings.nav.designations,
    roles: ["COMPANY_ADMIN", "HR"],
  },
  {
    to: "/leave-requests",
    label: strings.nav.leaveRequests,
    roles: ["COMPANY_ADMIN", "HR"],
  },
  {
    to: "/leave-requests/team",
    label: strings.nav.leaveRequests,
    roles: ["MANAGER"],
  },
  {
    to: "/my-leave",
    label: strings.nav.myLeave,
    roles: ["COMPANY_ADMIN", "HR", "MANAGER", "EMPLOYEE"],
  },
  {
    to: "/leave-types",
    label: strings.nav.leaveTypes,
    roles: ["COMPANY_ADMIN", "HR"],
  },
  {
    to: "/holidays",
    label: strings.nav.holidays,
    roles: ["COMPANY_ADMIN", "HR"],
  },
  {
    to: "/settings",
    label: strings.nav.settings,
    roles: ["COMPANY_ADMIN"],
  },
  {
    to: "/companies",
    label: strings.nav.companies,
    roles: ["SUPER_ADMIN"],
  },
];
