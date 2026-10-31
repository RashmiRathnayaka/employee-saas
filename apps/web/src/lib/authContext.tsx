import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser, LoginResponse, MeResponse } from "@employee-saas/shared";
import { api, ApiClientError, setOnAuthFailure, setPlatformLoginHint, wasLastLoginPlatform } from "./apiClient";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  login: (companyCode: string, identifier: string, password: string) => Promise<void>;
  platformLogin: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const navigate = useNavigate();

  const handleAuthFailure = useCallback(() => {
    setUser(null);
    setStatus("unauthenticated");
    navigate(wasLastLoginPlatform() ? "/platform/login" : "/login", { replace: true });
  }, [navigate]);

  useEffect(() => {
    setOnAuthFailure(handleAuthFailure);
    return () => setOnAuthFailure(null);
  }, [handleAuthFailure]);

  const loadMe = useCallback(async () => {
    try {
      const res = await api.get<MeResponse>("/auth/me");
      setUser(res.user);
      setStatus("authenticated");
    } catch {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    // Intentionally run once on mount - this is the session bootstrap.
    loadMe();
  }, [loadMe]);

  const login = useCallback(async (companyCode: string, identifier: string, password: string) => {
    const res = await api.post<LoginResponse>("/auth/login", { companyCode, identifier, password });
    setPlatformLoginHint(false);
    setUser(res.user);
    setStatus("authenticated");
  }, []);

  const platformLogin = useCallback(async (email: string, password: string) => {
    const res = await api.post<LoginResponse>("/auth/platform/login", { email, password });
    setPlatformLoginHint(true);
    setUser(res.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Best-effort - the cookies are cleared server-side if this succeeds,
      // but we still clear local state either way below.
    }
    setUser(null);
    setStatus("unauthenticated");
    navigate(wasLastLoginPlatform() ? "/platform/login" : "/login", { replace: true });
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ status, user, login, platformLogin, logout, refreshMe: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}
