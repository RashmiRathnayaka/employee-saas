import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NotificationDto } from "@employee-saas/shared";
import { AuthProvider } from "../lib/authContext";
import { NotificationBell } from "./NotificationBell";
import { strings } from "../strings";

function makeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: "n1",
    type: "LEAVE_REQUEST_SUBMITTED",
    title: "New leave request awaiting your approval",
    body: "Alex Perera requested 2 day(s) of leave (02 Mar 2026 - 03 Mar 2026).",
    relatedEntityType: "LeaveRequest",
    relatedEntityId: "r1",
    readAt: null,
    createdAt: "2026-01-05T18:45:00.000Z",
    ...overrides,
  };
}

// Mutable server-side state, so a PATCH visibly changes the next GET.
let unreadCount = 0;
let notifications: NotificationDto[] = [];
let markReadCalls: string[] = [];
let markAllCalls = 0;

const server = setupServer(
  http.get("/api/v1/auth/me", () =>
    HttpResponse.json({
      user: { id: "u1", companyId: "c1", employeeId: "e1", email: "manager@acme.test", role: "MANAGER", mustChangePassword: false },
    }),
  ),
  http.get("/api/v1/notifications/unread-count", () => HttpResponse.json({ count: unreadCount })),
  http.get("/api/v1/notifications", () =>
    HttpResponse.json({ data: notifications, page: 1, pageSize: 5, total: notifications.length }),
  ),
  http.patch("/api/v1/notifications/read-all", () => {
    markAllCalls++;
    const updated = notifications.filter((n) => n.readAt === null).length;
    notifications = notifications.map((n) => ({ ...n, readAt: n.readAt ?? "2026-01-06T00:00:00.000Z" }));
    unreadCount = 0;
    return HttpResponse.json({ updated });
  }),
  http.patch("/api/v1/notifications/:id/read", ({ params }) => {
    const id = String(params.id);
    markReadCalls.push(id);
    notifications = notifications.map((n) => (n.id === id ? { ...n, readAt: "2026-01-06T00:00:00.000Z" } : n));
    unreadCount = Math.max(0, unreadCount - 1);
    return HttpResponse.json({ notification: notifications.find((n) => n.id === id) });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  unreadCount = 0;
  notifications = [];
  markReadCalls = [];
  markAllCalls = 0;
});
afterAll(() => server.close());

function LeaveDetailStub() {
  const { id } = useParams();
  return <p>Leave request detail {id}</p>;
}

function renderBell() {
  // A fresh QueryClient per test, so no cached count leaks between tests.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<NotificationBell />} />
            <Route path="/leave-requests/:id" element={<LeaveDetailStub />} />
            <Route path="/notifications" element={<p>All notifications page</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NotificationBell", () => {
  it("shows the unread count on the badge", async () => {
    unreadCount = 3;
    renderBell();
    expect(await screen.findByTestId("notification-badge")).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: strings.notifications.bellLabelUnread(3) })).toBeInTheDocument();
  });

  it('caps the badge at "9+" above 9', async () => {
    unreadCount = 12;
    renderBell();
    expect(await screen.findByTestId("notification-badge")).toHaveTextContent("9+");
  });

  it("hides the badge when nothing is unread, and shows the empty state when opened", async () => {
    renderBell();
    const user = userEvent.setup();
    const bell = await screen.findByRole("button", { name: strings.notifications.bellLabel });
    expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument();

    await user.click(bell);
    expect(await screen.findByText(strings.notifications.empty)).toBeInTheDocument();
  });

  it("clicking a notification marks it read and opens the leave request", async () => {
    unreadCount = 1;
    notifications = [makeNotification()];
    renderBell();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: strings.notifications.bellLabelUnread(1) }));
    await user.click(await screen.findByText("New leave request awaiting your approval"));

    expect(await screen.findByText("Leave request detail r1")).toBeInTheDocument();
    await waitFor(() => expect(markReadCalls).toEqual(["n1"]));
  });

  it("does not re-mark an already-read notification, but still opens it", async () => {
    notifications = [makeNotification({ readAt: "2026-01-05T19:00:00.000Z" })];
    renderBell();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: strings.notifications.bellLabel }));
    await user.click(await screen.findByText("New leave request awaiting your approval"));

    expect(await screen.findByText("Leave request detail r1")).toBeInTheDocument();
    expect(markReadCalls).toEqual([]);
  });

  it('"Mark all as read" clears the badge', async () => {
    unreadCount = 2;
    notifications = [makeNotification(), makeNotification({ id: "n2", relatedEntityId: "r2", title: "Second" })];
    renderBell();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: strings.notifications.bellLabelUnread(2) }));
    await screen.findByText("Second");
    await user.click(screen.getByRole("button", { name: strings.notifications.markAllRead }));

    await waitFor(() => expect(markAllCalls).toBe(1));
    await waitFor(() => expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument());
  });

  it("shows an error state with retry when the list fails to load", async () => {
    unreadCount = 1;
    server.use(
      http.get("/api/v1/notifications", () =>
        HttpResponse.json({ error: { code: "INTERNAL_ERROR", message: "boom" } }, { status: 500 }),
      ),
    );
    renderBell();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: strings.notifications.bellLabelUnread(1) }));
    expect(await screen.findByText(strings.notifications.loadError)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.common.retry })).toBeInTheDocument();
  });
});
