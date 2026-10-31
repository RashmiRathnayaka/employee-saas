import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CompanyDto } from "@employee-saas/shared";
import { api } from "./apiClient";
import { useAuth } from "./authContext";

const DEFAULT_PRIMARY_COLOR = "#4f46e5";

type CompanyContextValue = {
  company: CompanyDto | null;
  timezone: string;
};

const CompanyContext = createContext<CompanyContextValue>({ company: null, timezone: "Asia/Colombo" });

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const hasCompany = status === "authenticated" && !!user?.companyId;

  const { data } = useQuery({
    queryKey: ["company"],
    queryFn: () => api.get<{ company: CompanyDto }>("/company"),
    enabled: hasCompany,
    staleTime: 5 * 60 * 1000,
  });

  const company = hasCompany ? data?.company ?? null : null;

  useEffect(() => {
    document.documentElement.style.setProperty("--color-primary", company?.primaryColor ?? DEFAULT_PRIMARY_COLOR);
  }, [company?.primaryColor]);

  return (
    <CompanyContext.Provider value={{ company, timezone: company?.timezone ?? "Asia/Colombo" }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany(): CompanyContextValue {
  return useContext(CompanyContext);
}
