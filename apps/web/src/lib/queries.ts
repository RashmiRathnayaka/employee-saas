import { useQuery } from "@tanstack/react-query";
import type { DepartmentDto, DesignationDto, EmployeeDto } from "@employee-saas/shared";
import { api } from "./apiClient";

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
