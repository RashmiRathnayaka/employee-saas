import { useQuery } from "@tanstack/react-query";
import { DEFAULT_TIMEZONE, type CompanyDto } from "@employee-saas/shared";
import { api } from "./apiClient";
import { useAuth } from "./authContext";

export const DEFAULT_PRIMARY_COLOR = "#4F46E5";

export function useCompany() {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["company"],
    queryFn: () => api.get<{ company: CompanyDto }>("/company"),
    enabled: status === "authenticated",
    select: (res) => res.company,
  });
}

/** The company's primary colour, applied as the app's accent colour - falls
 * back to a sensible default before the company profile has loaded. */
export function usePrimaryColor(): string {
  const { data: company } = useCompany();
  return company?.primaryColor ?? DEFAULT_PRIMARY_COLOR;
}

/** The company's IANA timezone (companies.timezone) - what "today" and
 * timestamps are shown in, so the app agrees with the API and the web
 * portal. Falls back to the platform default until the profile loads. */
export function useCompanyTimezone(): string {
  const { data: company } = useCompany();
  return company?.timezone ?? DEFAULT_TIMEZONE;
}
