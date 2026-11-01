import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../../lib/queryClient";
import { AuthProvider } from "../../lib/authContext";
import { strings } from "../../strings";
import LoginScreen from "../../app/login";

jest.mock("expo-router", () => {
  // jest.mock factories run before the file's own imports (Jest hoists
  // them), so they can't reference top-level imports - require() here is
  // the standard workaround, not a stray import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return {
    Redirect: ({ href }: { href: string }) => React.createElement(Text, null, `REDIRECT:${href}`),
    router: { replace: jest.fn(), push: jest.fn() },
  };
});

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

beforeEach(() => {
  // Not logged in by default - AuthProvider's bootstrap /auth/me call should
  // 401, landing LoginScreen in its normal unauthenticated state.
  routes = {
    "GET /api/v1/auth/me": () => jsonResponse({ error: { code: "UNAUTHENTICATED", message: "no session" } }, 401),
  };
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockClear();
});

afterEach(() => {
  (jest.requireMock("expo-secure-store") as { __reset: () => void }).__reset();
});

function renderLogin() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

async function fillAndSubmit() {
  await fireEvent.changeText(screen.getByLabelText(strings.login.companyCode), "ACME");
  await fireEvent.changeText(screen.getByLabelText(strings.login.identifier), "alex@acme.test");
  await fireEvent.changeText(screen.getByLabelText(strings.login.password), "Passw0rd!");
  await fireEvent.press(screen.getByRole("button", { name: strings.login.submit }));
}

describe("LoginScreen", () => {
  it("logs in and redirects to the authenticated tabs on success", async () => {
    mockRoute("POST", "/api/v1/auth/login", () =>
      jsonResponse({
        user: { id: "u1", companyId: "c1", employeeId: "e1", email: "alex@acme.test", role: "EMPLOYEE", mustChangePassword: false },
        accessToken: "access-1",
        refreshToken: "refresh-1",
      }),
    );

    await renderLogin();
    await fillAndSubmit();

    expect(await screen.findByText("REDIRECT:/(tabs)")).toBeTruthy();
  });

  it("shows a generic error message on invalid credentials, never a specific one", async () => {
    mockRoute("POST", "/api/v1/auth/login", () =>
      jsonResponse(
        { error: { code: "INVALID_CREDENTIALS", message: "Invalid company code, identifier, or password." } },
        401,
      ),
    );

    await renderLogin();
    await fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(strings.login.genericError);
  });

  it("shows a distinct rate-limit message, not the generic credentials one", async () => {
    mockRoute("POST", "/api/v1/auth/login", () =>
      jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many attempts." } }, 429),
    );

    await renderLogin();
    await fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(strings.login.rateLimited);
    expect(alert).not.toHaveTextContent(strings.login.genericError);
  });
});
