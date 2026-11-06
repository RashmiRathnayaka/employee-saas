import { useQuery } from "@tanstack/react-query";
import type { CompanySettingsDto, DepartmentDto, DesignationDto, EmployeeDto } from "@employee-saas/shared";
import { api } from "./apiClient";

/** The same query key the Settings page saves to, so switching a module on
 * updates the menu straight away. */
export function useCompanySettings(enabled = true) {
  return useQuery({
    queryKey: ["company-settings"],
    queryFn: () => api.get<{ settings: CompanySettingsDto }>("/company/settings"),
    select: (res) => res.settings,
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<{ data: DepartmentDto[] }>("/departments"),
    select: (res) => res.data,
    staleTime: 60 * 1000,
  });
}

export function useDesignations() {
  return useQuery({
    queryKey: ["designations"],
    queryFn: () => api.get<{ data: DesignationDto[] }>("/designations"),
    select: (res) => res.data,
    staleTime: 60 * 1000,
  });
}

// Used to populate "manager" dropdowns. Phase 1 doesn't have a dedicated
// employee-picker endpoint, so this takes the first page at the max page
// size - fine for the companies Phase 1 targets, revisit if a company grows
// past 100 employees.
export function useManagerOptions() {
  return useQuery({
    queryKey: ["employees", "manager-options"],
    queryFn: () => api.get<{ data: EmployeeDto[] }>("/employees?pageSize=100&status=ACTIVE"),
    select: (res) => res.data,
    staleTime: 60 * 1000,
  });
}
