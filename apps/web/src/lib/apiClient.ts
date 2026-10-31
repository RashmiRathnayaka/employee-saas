const BASE_URL = "/api/v1";

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

// Set by AuthProvider. Called when a request fails with 401 and the
// single-flight refresh below also fails - the one place the app reacts to
// "the session is really gone" by sending the user back to a login page.
let onAuthFailure: (() => void) | null = null;
export function setOnAuthFailure(handler: (() => void) | null) {
  onAuthFailure = handler;
}

// Tracks which login flow was last used (tenant vs. platform) purely to
// decide which login page to bounce back to on auth failure - not
// security-sensitive, just a UX hint.
const PLATFORM_HINT_KEY = "auth:lastLoginWasPlatform";
export function setPlatformLoginHint(isPlatform: boolean) {
  localStorage.setItem(PLATFORM_HINT_KEY, isPlatform ? "1" : "0");
}
export function wasLastLoginPlatform(): boolean {
  return localStorage.getItem(PLATFORM_HINT_KEY) === "1";
}

// Single-flight refresh: if several requests 401 at the same time, they all
// await this one shared promise instead of each calling /auth/refresh.
let refreshPromise: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
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
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    if (options.isFormData) {
      body = options.body as FormData;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
  }

  return fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers,
    body,
    signal: options.signal,
  });
}

const NO_REFRESH_PATHS = new Set(["/auth/login", "/auth/platform/login", "/auth/refresh", "/auth/logout"]);

export async function apiRequest<T>(path: string, options: RequestOptions = {}, _retried = false): Promise<T> {
  let res: Response;
  try {
    res = await rawRequest(path, options);
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR", "Could not reach the server.");
  }

  if (res.status === 401 && !_retried && !NO_REFRESH_PATHS.has(path)) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      return apiRequest<T>(path, options, true);
    }
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
