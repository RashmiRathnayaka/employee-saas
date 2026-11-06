import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AttendanceScreen from "../../app/(tabs)/attendance";
import { getNextHistoryPage } from "../../lib/attendance";
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

function makeRecord(day: number, overrides: object = {}) {
  const date = `2026-10-${String(day).padStart(2, "0")}`;
  return {
    id: `r${day}`,
    workDate: date,
    status: "PRESENT",
    lateMinutes: 0,
    checkInAt: `${date}T03:30:00.000Z`,
    checkOutAt: `${date}T11:30:00.000Z`,
    workedMinutes: 480,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let modules: Record<string, boolean>;
let total: number;
let historyPages: string[];

const fetchMock = jest.fn(async (url: string | URL) => {
  const parsed = new URL(url);
  const path = parsed.pathname.replace("/api/v1", "");
  if (path === "/auth/me") return jsonResponse({ user: ME_USER });
  if (path === "/company") return jsonResponse({ company: COMPANY });
  if (path === "/company/settings") return jsonResponse({ settings: { enabledModules: modules } });
  if (path === "/attendance/me") {
    const page = Number(parsed.searchParams.get("page"));
    historyPages.push(String(page));
    const data = page === 1 ? [makeRecord(2), makeRecord(1, { status: "LATE", lateMinutes: 12, checkOutAt: null, workedMinutes: null })] : [];
    return jsonResponse({ data: total === 0 ? [] : data, page, pageSize: 20, total });
  }
  throw new Error(`Unhandled fetch in test: ${path}`);
});

const clients: QueryClient[] = [];

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AttendanceScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  modules = { attendance: true };
  total = 2;
  historyPages = [];
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  (jest.requireMock("expo-secure-store") as { __reset: () => void }).__reset();
});

describe("AttendanceScreen", () => {
  it("lists my days with their status, times and worked hours", async () => {
    await renderScreen();

    expect(await screen.findByText("02 Oct 2026")).toBeTruthy();
    expect(screen.getByText("09:00 - 17:00 · 8h")).toBeTruthy();
    expect(screen.getByText("Late by 12 min")).toBeTruthy();
    expect(screen.getByText(`09:00 - ${strings.attendance.noCheckOut}`)).toBeTruthy();
  });

  it("shows an empty message when there's no history", async () => {
    total = 0;
    await renderScreen();

    expect(await screen.findByText(strings.attendance.noHistory)).toBeTruthy();
  });

  it("doesn't fetch anything when the module is off", async () => {
    modules = {};
    await renderScreen();

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/company/settings"))).toBe(true));
    expect(historyPages).toHaveLength(0);
  });
});

// Scrolling itself is on the phone checklist: a list only fires onEndReached once a
// real layout has measured it, and a test has no layout engine.
describe("getNextHistoryPage", () => {
  it.each([
    ["a full page with more to come", { page: 1, pageSize: 20, total: 45 }, 2],
    ["the page before the last", { page: 2, pageSize: 20, total: 45 }, 3],
    ["the last, partly full page", { page: 3, pageSize: 20, total: 45 }, undefined],
    ["a last page that's exactly full", { page: 2, pageSize: 20, total: 40 }, undefined],
    ["no records", { page: 1, pageSize: 20, total: 0 }, undefined],
  ])("%s", (_label, last, next) => {
    expect(getNextHistoryPage(last)).toBe(next);
  });
});
