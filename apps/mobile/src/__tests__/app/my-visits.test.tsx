import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MyVisitsScreen from "../../app/my-visits";
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
    router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
    useFocusEffect: (effect: () => void) => React.useEffect(effect, [effect]),
  };
});

process.env.EXPO_PUBLIC_API_URL = "http://localhost:4000/api/v1";

const ME_USER = { id: "u1", companyId: "c1", employeeId: "e1", email: "alex@acme.test", role: "EMPLOYEE", mustChangePassword: false };
const COMPANY = { id: "c1", name: "Acme", code: "ACME", status: "ACTIVE", timezone: "Asia/Colombo", logoUrl: null, primaryColor: null, createdAt: "2026-01-01T00:00:00.000Z" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const visit = (overrides: object) => ({
  id: "v1",
  siteName: "Warehouse",
  workDate: "2026-11-03",
  status: "CLOSED",
  checkInAt: "2026-11-03T05:00:00.000Z", // 10:30 in Colombo
  checkOutAt: "2026-11-03T06:30:00.000Z", // 12:00
  durationMinutes: 90,
  flags: [],
  ...overrides,
});

let modules: Record<string, boolean>;
let onVisits: () => Response;
let visitRequests: number;

const fetchMock = jest.fn(async (input: string | URL) => {
  const path = new URL(input).pathname.replace("/api/v1", "");
  switch (path) {
    case "/auth/me":
      return jsonResponse({ user: ME_USER });
    case "/company":
      return jsonResponse({ company: COMPANY });
    case "/company/settings":
      return jsonResponse({ settings: { enabledModules: modules } });
    case "/site-visits/me":
      visitRequests += 1;
      return onVisits();
    default:
      throw new Error(`Unhandled fetch in test: ${path}`);
  }
});

const clients: QueryClient[] = [];

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MyVisitsScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const respondWith = (rows: object[]) => () => jsonResponse({ data: rows, page: 1, pageSize: 20, total: rows.length });

beforeEach(() => {
  modules = { sites: true };
  onVisits = respondWith([]);
  visitRequests = 0;
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  (jest.requireMock("expo-secure-store") as { __reset: () => void }).__reset();
});

describe("My visits", () => {
  it("marks a visit HR has corrected", async () => {
    onVisits = respondWith([visit({ isCorrected: true })]);
    await renderScreen();

    expect(await screen.findByText(strings.siteVisits.corrected)).toBeTruthy();
  });

  it("a closed visit: the site, the date, company-time times and the duration", async () => {
    onVisits = respondWith([visit({})]);
    await renderScreen();

    expect(await screen.findByText("Warehouse")).toBeTruthy();
    expect(screen.getByText("10:30 - 12:00 · 1h 30m")).toBeTruthy();
    expect(screen.getByText("03 Nov 2026")).toBeTruthy();
  });

  it("an open visit says so, with no end time or duration", async () => {
    onVisits = respondWith([visit({ status: "OPEN", checkOutAt: null, durationMinutes: null })]);
    await renderScreen();

    expect(await screen.findByText(`10:30 - ${strings.siteVisits.status.OPEN}`)).toBeTruthy();
  });

  it("an auto-closed visit has no check-out", async () => {
    onVisits = respondWith([visit({ status: "AUTO_CLOSED", checkOutAt: null, durationMinutes: null })]);
    await renderScreen();

    expect(await screen.findByText(`10:30 - ${strings.attendance.noCheckOut}`)).toBeTruthy();
  });

  it.each([
    ["AFTER_HOURS", strings.siteVisits.afterHours],
    ["ON_ABSENT_DAY", strings.siteVisits.onAbsentDay],
  ])("%s is explained", async (flag, text) => {
    onVisits = respondWith([visit({ flags: [flag] })]);
    await renderScreen();

    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("a GPS flag isn't shown here", async () => {
    onVisits = respondWith([visit({ flags: ["LOW_ACCURACY"] })]);
    await renderScreen();

    await screen.findByText("Warehouse");

    expect(screen.queryByText(strings.siteVisits.afterHours)).toBeNull();
    expect(screen.queryByText(/LOW_ACCURACY/)).toBeNull();
  });

  it("nothing yet: says so", async () => {
    await renderScreen();

    expect(await screen.findByText(strings.siteVisits.noVisits)).toBeTruthy();
  });

  it("a failed load offers a retry", async () => {
    onVisits = () => {
      throw new TypeError("Network request failed");
    };
    await renderScreen();

    expect(await screen.findByText(strings.attendance.offline)).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.common.retry })).toBeTruthy();
  });

  it("with the module off, it never asks the server", async () => {
    modules = {};
    await renderScreen();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(visitRequests).toBe(0);
  });
});
