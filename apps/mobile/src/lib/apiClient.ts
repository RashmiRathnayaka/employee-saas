import Constants from "expo-constants";
import { clearTokens, getTokens, setTokens } from "./secureStore";

function resolveBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined);
  if (!url) {
    throw new ApiClientError(
      0,
      "CONFIG_ERROR",
      "EXPO_PUBLIC_API_URL is not set. Copy apps/mobile/.env.example to .env and set your computer's LAN IP.",
    );
  }
  return url.replace(/\/+$/, "");
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Set by AuthProvider - the one place the app reacts to "the session is
// really gone" (refresh failed) by clearing state and bouncing to login.
let onAuthFailure: (() => void) | null = null;
export function setOnAuthFailure(handler: (() => void) | null) {
  onAuthFailure = handler;
}

// Single-flight refresh: concurrent 401s all await this one shared promise
// instead of each calling /auth/refresh (mirrors apps/web/src/lib/apiClient.ts).
let refreshPromise: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const { refreshToken } = await getTokens();
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${resolveBaseUrl()}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Client": "mobile" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
        if (!data.accessToken || !data.refreshToken) return false;
        await setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  body?: unknown;
  signal?: AbortSignal;
  /** Set for multipart/form-data uploads - body must already be a FormData. */
  isFormData?: boolean;
};

async function parseErrorBody(res: Response): Promise<{ code: string; message: string; details?: unknown }> {
  try {
    const data = await res.json();
    if (data?.error?.code && data?.error?.message) {
      return data.error;
    }
  } catch {
    // fall through to generic message below
  }
  return { code: "UNKNOWN_ERROR", message: res.statusText || "Request failed" };
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const { accessToken } = await getTokens();
  const headers: Record<string, string> = { "X-Client": "mobile" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.isFormData) {
      body = options.body as FormData;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
  }

  return fetch(`${resolveBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
    signal: options.signal,
  });
}

const NO_REFRESH_PATHS = new Set(["/auth/login", "/auth/refresh", "/auth/logout"]);

export async function apiRequest<T>(path: string, options: RequestOptions = {}, _retried = false): Promise<T> {
  let res: Response;
  try {
    res = await rawRequest(path, options);
  } catch (error) {
    // A thrown fetch() here means the request never reached the network at
    // all - that's genuinely "offline/wrong URL" for a plain JSON request,
    // but for a multipart upload it's just as likely to be a bad file (an
    // unreadable uri, a FormData part the native layer rejected) failing
    // before any bytes go out. Logged (not shown to the user - it's a raw
    // JS error, never request/response content) so this is still
    // debuggable instead of silently indistinguishable from a network
    // outage, which is what masked the real cause of this exact bug before.
    if (__DEV__) {
      console.warn(`[apiClient] ${options.method ?? "GET"} ${path} failed before a response:`, error);
    }
    if (options.isFormData) {
      throw new ApiClientError(0, "UPLOAD_FAILED", "Could not prepare or send the file. Try a different photo or file.");
    }
    throw new ApiClientError(0, "NETWORK_ERROR", "Could not reach the server. Check your Wi-Fi and the API URL.");
  }

  if (res.status === 401 && !_retried && !NO_REFRESH_PATHS.has(path)) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      return apiRequest<T>(path, options, true);
    }
    await clearTokens();
    onAuthFailure?.();
    const error = await parseErrorBody(res);
    throw new ApiClientError(401, error.code, error.message, error.details);
  }

  if (!res.ok) {
    const error = await parseErrorBody(res);
    throw new ApiClientError(res.status, error.code, error.message, error.details);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: "GET", signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    apiRequest<T>(path, { method: "POST", body, signal }),
  patch: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    apiRequest<T>(path, { method: "PATCH", body, signal }),
  delete: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: "DELETE", signal }),
  upload: <T>(path: string, formData: FormData, signal?: AbortSignal) =>
    apiRequest<T>(path, { method: "POST", body: formData, isFormData: true, signal }),
};

export function getApiOrigin(): string {
  return new URL(resolveBaseUrl()).origin;
}
