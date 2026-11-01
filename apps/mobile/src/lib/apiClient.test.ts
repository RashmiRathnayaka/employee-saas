import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { apiRequest, setOnAuthFailure } from "./apiClient";
import { getTokens, setTokens } from "./secureStore";

process.env.EXPO_PUBLIC_API_URL = "http://localhost:4000/api/v1";

type RouteHandler = () => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let routes: Record<string, RouteHandler> = {};
function mockRoute(method: string, path: string, handler: RouteHandler) {
  routes[`${method} ${path}`] = handler;
}

const fetchMock = jest.fn(async (url: string | URL, init: RequestInit = {}) => {
  const method = (init.method ?? "GET").toUpperCase();
  const pathname = new URL(url).pathname;
  const handler = routes[`${method} ${pathname}`];
  if (!handler) {
    throw new Error(`Unhandled fetch in test: ${method} ${pathname}`);
  }
  return handler();
});

beforeEach(async () => {
  routes = {};
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockClear();
  await setTokens({ accessToken: "initial-access", refreshToken: "initial-refresh" });
});

afterEach(() => {
  setOnAuthFailure(null);
  (jest.requireMock("expo-secure-store") as { __reset: () => void }).__reset();
});

describe("apiRequest - refresh-once-then-retry", () => {
  it("refreshes once and retries a single 401, returning the retried response", async () => {
    let calls = 0;
    let refreshCalls = 0;
    mockRoute("GET", "/api/v1/x", () => {
      calls++;
      if (calls === 1) {
        return jsonResponse({ error: { code: "UNAUTHENTICATED", message: "nope" } }, 401);
      }
      return jsonResponse({ ok: true });
    });
    mockRoute("POST", "/api/v1/auth/refresh", () => {
      refreshCalls++;
      return jsonResponse({ accessToken: "new-access", refreshToken: "new-refresh" });
    });

    const result = await apiRequest<{ ok: boolean }>("/x");

    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(refreshCalls).toBe(1);
    expect((await getTokens()).accessToken).toBe("new-access");
  });

  it("only calls /auth/refresh once when two requests 401 at the same time", async () => {
    let refreshCalls = 0;
    const attemptCounts: Record<string, number> = { "/a": 0, "/b": 0 };

    for (const path of ["/a", "/b"]) {
      mockRoute("GET", `/api/v1${path}`, () => {
        attemptCounts[path]!++;
        if (attemptCounts[path] === 1) {
          return jsonResponse({ error: { code: "UNAUTHENTICATED", message: "nope" } }, 401);
        }
        return jsonResponse({ path });
      });
    }

    mockRoute("POST", "/api/v1/auth/refresh", async () => {
      refreshCalls++;
      // Small delay so both parallel callers are guaranteed to see the
      // in-flight refresh instead of racing ahead of each other.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonResponse({ accessToken: "new-access", refreshToken: "new-refresh" });
    });

    const [resultA, resultB] = await Promise.all([
      apiRequest<{ path: string }>("/a"),
      apiRequest<{ path: string }>("/b"),
    ]);

    expect(resultA).toEqual({ path: "/a" });
    expect(resultB).toEqual({ path: "/b" });
    expect(refreshCalls).toBe(1);
  });

  it("clears tokens and calls onAuthFailure when refresh itself fails", async () => {
    const onAuthFailure = jest.fn();
    setOnAuthFailure(onAuthFailure);

    mockRoute("GET", "/api/v1/y", () => jsonResponse({ error: { code: "UNAUTHENTICATED", message: "nope" } }, 401));
    mockRoute("POST", "/api/v1/auth/refresh", () =>
      jsonResponse({ error: { code: "UNAUTHENTICATED", message: "refresh token expired" } }, 401),
    );

    await expect(apiRequest("/y")).rejects.toMatchObject({ status: 401 });
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect((await getTokens()).accessToken).toBeNull();
  });
});
