import { isModuleEnabled, type CompanyModule, type Role } from "@employee-saas/shared";
import { strings } from "../strings";

/** `module`: the item only shows while that module is on for the company. */
export type NavItem = { to: string; label: string; roles: Role[]; module?: CompanyModule };

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
    to: "/sites",
    label: strings.nav.sites,
    roles: ["COMPANY_ADMIN", "HR"],
    module: "sites",
  },
  {
    to: "/site-visits",
    label: strings.nav.siteVisits,
    roles: ["COMPANY_ADMIN", "HR", "MANAGER"],
    module: "sites",
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

/** What this role sees in the menu. Hiding is only a convenience: the API
 * enforces roles and modules. Until settings have loaded, gated items stay
 * hidden, so a switched-off feature never flashes into view. */
export function visibleNavItems(role: Role, settings: { enabledModules?: unknown } | null | undefined): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.roles.includes(role) && (!item.module || isModuleEnabled(settings, item.module)),
  );
}
