import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { apiRequest, setOnAuthFailure } from "./apiClient";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  setOnAuthFailure(null);
});
afterAll(() => server.close());

describe("apiRequest - refresh-once-then-retry", () => {
  it("refreshes once and retries a single 401, returning the retried response", async () => {
    let calls = 0;
    let refreshCalls = 0;
    server.use(
      http.get("/api/v1/x", () => {
        calls++;
        if (calls === 1) {
          return HttpResponse.json({ error: { code: "UNAUTHENTICATED", message: "nope" } }, { status: 401 });
        }
        return HttpResponse.json({ ok: true });
      }),
      http.post("/api/v1/auth/refresh", () => {
        refreshCalls++;
        return HttpResponse.json({});
      }),
    );

    const result = await apiRequest<{ ok: boolean }>("/x");

    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(refreshCalls).toBe(1);
  });

  it("only calls /auth/refresh once when two requests 401 at the same time", async () => {
    let refreshCalls = 0;
    const attemptCounts: Record<string, number> = { "/a": 0, "/b": 0 };

    for (const path of ["/a", "/b"]) {
      server.use(
        http.get(`/api/v1${path}`, () => {
          attemptCounts[path]!++;
          if (attemptCounts[path] === 1) {
            return HttpResponse.json({ error: { code: "UNAUTHENTICATED", message: "nope" } }, { status: 401 });
          }
          return HttpResponse.json({ path });
        }),
      );
    }

    server.use(
      http.post("/api/v1/auth/refresh", async () => {
        refreshCalls++;
        // Small delay so both parallel callers are guaranteed to see the
        // in-flight refresh instead of racing ahead of each other.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json({});
      }),
    );

    const [resultA, resultB] = await Promise.all([
      apiRequest<{ path: string }>("/a"),
      apiRequest<{ path: string }>("/b"),
    ]);

    expect(resultA).toEqual({ path: "/a" });
    expect(resultB).toEqual({ path: "/b" });
    expect(refreshCalls).toBe(1);
  });

  it("calls onAuthFailure and throws when refresh itself fails", async () => {
    const onAuthFailure = vi.fn();
    setOnAuthFailure(onAuthFailure);

    server.use(
      http.get("/api/v1/c", () =>
        HttpResponse.json({ error: { code: "UNAUTHENTICATED", message: "nope" } }, { status: 401 }),
      ),
      http.post("/api/v1/auth/refresh", () =>
        HttpResponse.json({ error: { code: "UNAUTHENTICATED", message: "nope" } }, { status: 401 }),
      ),
    );

    await expect(apiRequest("/c")).rejects.toMatchObject({ status: 401 });
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("does not attempt a refresh for /auth/login itself", async () => {
    let refreshCalls = 0;
    server.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json({ error: { code: "UNAUTHENTICATED", message: "bad creds" } }, { status: 401 }),
      ),
      http.post("/api/v1/auth/refresh", () => {
        refreshCalls++;
        return HttpResponse.json({});
      }),
    );

    await expect(apiRequest("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls).toBe(0);
  });
});
