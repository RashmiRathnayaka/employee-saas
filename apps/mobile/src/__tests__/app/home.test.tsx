import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HomeScreen from "../../app/(tabs)/index";
import { AuthProvider } from "../../lib/authContext";
import { strings } from "../../strings";

jest.mock("expo-router", () => {
  // jest.mock factories are hoisted above imports - require() is the
  // standard workaround, not a stray import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return {
    Redirect: ({ href }: { href: string }) => React.createElement(Text, null, `REDIRECT:${href}`),
    router: { replace: jest.fn(), push: jest.fn() },
    // Runs once, like a screen coming into focus.
    useFocusEffect: (effect: () => void) => React.useEffect(effect, [effect]),
  };
});

process.env.EXPO_PUBLIC_API_URL = "http://localhost:4000/api/v1";

const ME_USER = { id: "u1", companyId: "c1", employeeId: "e1", email: "alex@acme.test", role: "EMPLOYEE", mustChangePassword: false };
const COMPANY = { id: "c1", name: "Acme", code: "ACME", status: "ACTIVE", timezone: "Asia/Colombo", logoUrl: null, primaryColor: null, createdAt: "2026-01-01T00:00:00.000Z" };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

let requests: { status: string }[];
let modules: Record<string, boolean>;

const fetchMock = jest.fn(async (url: string | URL) => {
  const path = new URL(url).pathname.replace("/api/v1", "");
  switch (path) {
    case "/auth/me":
      return jsonResponse({ user: ME_USER });
    case "/company":
      return jsonResponse({ company: COMPANY });
    case "/company/settings":
      return jsonResponse({ settings: { enabledModules: modules } });
    case "/site-visits/me/open":
      return jsonResponse({ visit: null, gpsRequired: false });
    case "/employees/me":
      return jsonResponse({ employee: { firstName: "Alex" } });
    case "/leave-types":
    case "/leave-balances/me":
      return jsonResponse({ data: [] });
    case "/leave-requests/me":
      return jsonResponse({ data: requests, page: 1, pageSize: 100, total: requests.length });
    case "/notifications/unread-count":
      return jsonResponse({ count: 0 });
    default:
      throw new Error(`Unhandled fetch in test: ${path}`);
  }
});

const clients: QueryClient[] = [];

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <HomeScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const fontSizeOf = (text: { props: Record<string, unknown> }) =>
  (StyleSheet.flatten(text.props.style as never) as { fontSize?: number }).fontSize;

beforeEach(() => {
  requests = [];
  modules = {};
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  (jest.requireMock("expo-secure-store") as { __reset: () => void }).__reset();
});

describe("Home, Pending requests card", () => {
  it("nothing pending: the words are normal secondary text, the same size as other empty states", async () => {
    await renderHome();

    const empty = await screen.findByText(strings.home.pendingRequestsCount_zero);
    const otherEmptyState = screen.getByText(strings.home.noUpcomingLeave);

    expect(fontSizeOf(empty)).toBe(fontSizeOf(otherEmptyState));
  });

  it("something pending: the count stays big", async () => {
    requests = [{ status: "PENDING_MANAGER" }, { status: "PENDING_HR" }, { status: "APPROVED" }].map((r, i) => ({
      ...r,
      id: `r${i}`,
      startDate: "2020-01-01",
      endDate: "2020-01-01",
    }));
    await renderHome();

    const count = await screen.findByText("2");

    expect(fontSizeOf(count)).toBeGreaterThan(fontSizeOf(screen.getByText(strings.home.noUpcomingLeave))!);
    expect(screen.queryByText(strings.home.pendingRequestsCount_zero)).toBeNull();
  });
});

describe("Home, Site visit card", () => {
  it("shows while the sites module is on, even with attendance off", async () => {
    modules = { sites: true };
    await renderHome();

    expect(await screen.findByRole("button", { name: strings.siteVisits.checkIn })).toBeTruthy();
    expect(screen.queryByText(strings.attendance.title)).toBeNull();
  });

  it("is hidden while the module is off, and never asks the server", async () => {
    await renderHome();
    await screen.findByText(strings.home.pendingRequests);

    expect(screen.queryByText(strings.siteVisits.title)).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/site-visits"))).toBe(false);
  });
});
