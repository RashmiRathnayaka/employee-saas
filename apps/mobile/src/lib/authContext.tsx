import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthUser, LoginResponse, MeResponse } from "@employee-saas/shared";
import { api, ApiClientError, setOnAuthFailure } from "./apiClient";
import { clearTokens, setTokens } from "./secureStore";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  login: (companyCode: string, identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const handleAuthFailure = useCallback(() => {
    setUser(null);
    setStatus("unauthenticated");
  }, []);

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
    // Intentionally run once on mount - this is the session bootstrap. If
    // there are no stored tokens, /auth/me 401s immediately and we land on
    // "unauthenticated", which is the correct first-launch state too.
    loadMe();
  }, [loadMe]);

  const login = useCallback(async (companyCode: string, identifier: string, password: string) => {
    const res = await api.post<LoginResponse>("/auth/login", { companyCode, identifier, password });
    if (res.accessToken && res.refreshToken) {
      await setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    }
    setUser(res.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Best-effort - tokens are cleared locally either way below.
    }
    await clearTokens();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, login, logout, refreshMe: loadMe }}>
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
