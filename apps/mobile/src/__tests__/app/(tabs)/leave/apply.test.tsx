import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../../../../lib/queryClient";
import { AuthProvider } from "../../../../lib/authContext";
import { strings } from "../../../../strings";
import ApplyLeaveScreen from "../../../../app/(tabs)/leave/apply";

jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), push: jest.fn() },
}));

process.env.EXPO_PUBLIC_API_URL = "http://localhost:4000/api/v1";

type RouteHandler = () => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const ME_USER = { id: "u1", companyId: "c1", employeeId: "e1", email: "alex@acme.test", role: "EMPLOYEE", mustChangePassword: false };
const LEAVE_TYPE = {
  id: "lt1",
  name: "Annual Leave",
  code: "ANNUAL",
  defaultAnnualDays: 14,
  requiresProof: false,
  carryForwardAllowed: false,
  allowPastDates: false,
};

let routes: Record<string, RouteHandler>;

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
  routes = {
    "GET /api/v1/auth/me": () => jsonResponse({ user: ME_USER }),
    "GET /api/v1/company": () =>
      jsonResponse({ company: { id: "c1", name: "Acme", code: "ACME", status: "ACTIVE", timezone: "Asia/Colombo", logoUrl: null, primaryColor: null, createdAt: "2026-01-01T00:00:00.000Z" } }),
    "GET /api/v1/leave-types": () => jsonResponse({ data: [LEAVE_TYPE] }),
    "POST /api/v1/leave-requests/preview": () => jsonResponse({ totalDays: 1 }),
  };
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockClear();
});

afterEach(() => {
  (jest.requireMock("expo-secure-store") as { __reset: () => void }).__reset();
});

function renderApplyScreen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ApplyLeaveScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function submittedLeaveRequestCalls(): number {
  return fetchMock.mock.calls.filter(([url, init]) => {
    const u = url as string | URL;
    const i = (init ?? {}) as RequestInit;
    return new URL(u).pathname === "/api/v1/leave-requests" && (i.method ?? "GET").toUpperCase() === "POST";
  }).length;
}

async function pickDate(fieldLabel: string, isoDate: string) {
  (globalThis as Record<string, unknown>).__TEST_NEXT_PICKED_DATE__ = isoDate;
  await fireEvent.press(screen.getByLabelText(fieldLabel));
  await fireEvent.press(screen.getByTestId("mock-date-time-picker"));
}

describe("ApplyLeaveScreen validation", () => {
  it("shows friendly field errors (never the raw zod/regex message) and does not submit when leave type and dates are missing", async () => {
    await renderApplyScreen();

    await fireEvent.press(await screen.findByRole("button", { name: strings.applyLeave.submit }));

    expect(await screen.findByText(strings.applyLeave.leaveTypeRequired)).toBeTruthy();
    expect(screen.getByText(strings.applyLeave.startDateRequired)).toBeTruthy();
    expect(screen.getByText(strings.applyLeave.endDateRequired)).toBeTruthy();
    expect(screen.queryByText("must be YYYY-MM-DD")).toBeNull();
    expect(submittedLeaveRequestCalls()).toBe(0);
  });

  it("rejects both half-day flags set on what has become a single-day request", async () => {
    await renderApplyScreen();

    // Multi-day range first - both half-day toggles are legitimately
    // independent here (first day half, last day half).
    await pickDate(strings.applyLeave.startDate, "2026-01-05");
    await pickDate(strings.applyLeave.endDate, "2026-01-06");
    await fireEvent.press(await screen.findByText(LEAVE_TYPE.name));
    await fireEvent(screen.getAllByRole("switch")[0]!, "valueChange", true);
    await fireEvent(screen.getAllByRole("switch")[1]!, "valueChange", true);

    // Collapse the range to a single day without touching the switches -
    // this is exactly the state the mutual-exclusion UI can't prevent on
    // its own, so the submit-time guard has to catch it.
    await pickDate(strings.applyLeave.endDate, "2026-01-05");

    await fireEvent.press(screen.getByRole("button", { name: strings.applyLeave.submit }));

    expect(await screen.findByText(strings.applyLeave.halfDaySingleDayOnly)).toBeTruthy();
    expect(submittedLeaveRequestCalls()).toBe(0);
  });
});
