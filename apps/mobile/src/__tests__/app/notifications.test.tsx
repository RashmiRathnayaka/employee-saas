import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NotificationDto } from "@employee-saas/shared";
import { AuthProvider } from "../../lib/authContext";
import { strings } from "../../strings";
import NotificationsScreen from "../../app/notifications";
import { NotificationBell } from "../../components/NotificationBell";

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
  };
});

process.env.EXPO_PUBLIC_API_URL = "http://localhost:4000/api/v1";

const ME_USER = { id: "u1", companyId: "c1", employeeId: "e1", email: "alex@acme.test", role: "EMPLOYEE", mustChangePassword: false };
const COMPANY = {
  id: "c1",
  name: "Acme",
  code: "ACME",
  status: "ACTIVE",
  timezone: "Asia/Colombo",
  logoUrl: null,
  primaryColor: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function makeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: "n1",
    type: "LEAVE_REQUEST_APPROVED",
    title: "Your leave request was approved",
    body: "Your 2-day leave (02 Mar 2026 - 03 Mar 2026) was approved.",
    relatedEntityType: "LeaveRequest",
    relatedEntityId: "r1",
    readAt: null,
    createdAt: "2026-01-05T18:45:00.000Z", // 00:15 on 6 Jan in Colombo
    ...overrides,
  };
}

type RouteHandler = (url: URL) => Response | Promise<Response>;
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let routes: Record<string, RouteHandler>;
let notifications: NotificationDto[];
let unreadCount: number;

const fetchMock = jest.fn(async (url: string | URL, init: RequestInit = {}) => {
  const method = (init.method ?? "GET").toUpperCase();
  const parsed = new URL(url);
  // "PATCH /api/v1/notifications/<id>/read" is matched by a pattern key.
  const key = `${method} ${parsed.pathname.replace(/^\/api\/v1\/notifications\/[^/]+\/read$/, "/api/v1/notifications/:id/read")}`;
  const handler = routes[key];
  if (!handler) throw new Error(`Unhandled fetch in test: ${method} ${parsed.pathname}`);
  return handler(parsed);
});

function callsTo(method: string, pathname: string): number {
  return fetchMock.mock.calls.filter(([url, init]) => {
    const i = (init ?? {}) as RequestInit;
    return new URL(url as string).pathname === pathname && (i.method ?? "GET").toUpperCase() === method;
  }).length;
}

beforeEach(() => {
  notifications = [];
  unreadCount = 0;
  routes = {
    "GET /api/v1/auth/me": () => jsonResponse({ user: ME_USER }),
    "GET /api/v1/company": () => jsonResponse({ company: COMPANY }),
    "GET /api/v1/notifications/unread-count": () => jsonResponse({ count: unreadCount }),
    "GET /api/v1/notifications": (url) =>
      jsonResponse({ data: notifications, page: Number(url.searchParams.get("page")), pageSize: 20, total: notifications.length }),
    "PATCH /api/v1/notifications/:id/read": () => {
      notifications = notifications.map((n) => ({ ...n, readAt: n.readAt ?? "2026-01-06T00:00:00.000Z" }));
      unreadCount = Math.max(0, unreadCount - 1);
      return jsonResponse({ notification: notifications[0] });
    },
    "PATCH /api/v1/notifications/read-all": () => {
      const updated = notifications.filter((n) => n.readAt === null).length;
      notifications = notifications.map((n) => ({ ...n, readAt: n.readAt ?? "2026-01-06T00:00:00.000Z" }));
      unreadCount = 0;
      return jsonResponse({ updated });
    },
  };
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockClear();
  (jest.requireMock("expo-router") as { router: { push: jest.Mock } }).router.push.mockClear();
});

afterEach(() => {
  (jest.requireMock("expo-secure-store") as { __reset: () => void }).__reset();
});

// gcTime: Infinity - React Query otherwise schedules a 5-minute cache
// clean-up timer per query *and* per mutation, and Jest waits for those
// timers before it can exit (that made this file take ~5 minutes on its
// own). Infinity schedules none; clear() drops the cache afterwards.
const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
});

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
  });
  clients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>,
  );
}

describe("NotificationsScreen", () => {
  it("renders notifications with title, body and local (company-timezone) time", async () => {
    notifications = [
      makeNotification(),
      makeNotification({
        id: "n2",
        title: "More information needed",
        body: 'HR note: "Add the stamp"',
        readAt: "2026-01-06T01:00:00.000Z",
        createdAt: "2026-01-04T10:00:00.000Z",
      }),
    ];
    unreadCount = 1;
    await renderWithProviders(<NotificationsScreen />);

    expect(await screen.findByText("Your leave request was approved")).toBeTruthy();
    expect(screen.getByText('HR note: "Add the stamp"')).toBeTruthy();
    expect(screen.getByText("06 Jan 2026, 00:15")).toBeTruthy(); // 18:45 UTC shown as Colombo time
    // Unread rows say so to screen readers.
    expect(screen.getByLabelText(`Your leave request was approved, ${strings.notifications.unread}`)).toBeTruthy();
  });

  it("tapping a notification marks it read and opens the leave request", async () => {
    notifications = [makeNotification()];
    unreadCount = 1;
    await renderWithProviders(<NotificationsScreen />);

    await fireEvent.press(await screen.findByText("Your leave request was approved"));

    const { router } = jest.requireMock("expo-router") as { router: { push: jest.Mock } };
    expect(router.push).toHaveBeenCalledWith("/leave/r1");
    await waitFor(() => expect(callsTo("PATCH", "/api/v1/notifications/n1/read")).toBe(1));
  });

  it("tapping an already-read notification opens it without another PATCH", async () => {
    notifications = [makeNotification({ readAt: "2026-01-06T01:00:00.000Z" })];
    await renderWithProviders(<NotificationsScreen />);

    await fireEvent.press(await screen.findByText("Your leave request was approved"));

    const { router } = jest.requireMock("expo-router") as { router: { push: jest.Mock } };
    expect(router.push).toHaveBeenCalledWith("/leave/r1");
    expect(callsTo("PATCH", "/api/v1/notifications/n1/read")).toBe(0);
  });

  it('"Mark all as read" calls read-all', async () => {
    notifications = [makeNotification(), makeNotification({ id: "n2", relatedEntityId: "r2", title: "Second" })];
    unreadCount = 2;
    await renderWithProviders(<NotificationsScreen />);

    await screen.findByText("Second");
    const button = await screen.findByRole("button", { name: strings.notifications.markAllRead });
    await waitFor(() => expect(button.props.accessibilityState?.disabled).toBe(false));
    await fireEvent.press(button);

    await waitFor(() => expect(callsTo("PATCH", "/api/v1/notifications/read-all")).toBe(1));
  });

  it('shows "No notifications yet" when there are none', async () => {
    await renderWithProviders(<NotificationsScreen />);
    expect(await screen.findByText(strings.notifications.empty)).toBeTruthy();
  });

  it("shows an error with retry when loading fails", async () => {
    routes["GET /api/v1/notifications"] = () => jsonResponse({ error: { code: "INTERNAL_ERROR", message: "boom" } }, 500);
    await renderWithProviders(<NotificationsScreen />);
    expect(await screen.findByText(strings.notifications.loadError)).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.common.retry })).toBeTruthy();
  });
});

describe("NotificationBell (Home header)", () => {
  it('shows the unread count, capped at "9+", and opens the notifications screen', async () => {
    unreadCount = 12;
    await renderWithProviders(<NotificationBell />);

    const bell = await screen.findByLabelText(strings.notifications.bellLabelUnread(12));
    expect(screen.getByText("9+")).toBeTruthy();
    expect(screen.getByTestId("icon-notifications-outline")).toBeTruthy();

    await fireEvent.press(bell);
    const { router } = jest.requireMock("expo-router") as { router: { push: jest.Mock } };
    expect(router.push).toHaveBeenCalledWith("/notifications");
  });

  it("hides the badge when nothing is unread", async () => {
    await renderWithProviders(<NotificationBell />);
    await screen.findByLabelText(strings.notifications.bellLabel);
    expect(screen.queryByTestId("notification-badge")).toBeNull();
  });
});
