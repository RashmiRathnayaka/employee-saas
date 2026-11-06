import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NotificationDto } from "@employee-saas/shared";
import { AuthProvider } from "../lib/authContext";
import { NotificationsPage } from "./NotificationsPage";
import { strings } from "../strings";

const requests: URLSearchParams[] = [];

function row(i: number, readAt: string | null): NotificationDto {
  return {
    id: `n${i}`,
    type: "LEAVE_REQUEST_APPROVED",
    title: `Notification ${i}`,
    body: "Body",
    relatedEntityType: "LeaveRequest",
    relatedEntityId: `r${i}`,
    readAt,
    createdAt: "2026-01-05T18:45:00.000Z",
  };
}

const server = setupServer(
  http.get("/api/v1/auth/me", () =>
    HttpResponse.json({
      user: { id: "u1", companyId: "c1", employeeId: "e1", email: "hr@acme.test", role: "HR", mustChangePassword: false },
    }),
  ),
  http.get("/api/v1/notifications/unread-count", () => HttpResponse.json({ count: 1 })),
  http.get("/api/v1/notifications", ({ request }) => {
    const search = new URL(request.url).searchParams;
    requests.push(search);
    if (search.get("unreadOnly") === "true") {
      return HttpResponse.json({ data: [row(1, null)], page: 1, pageSize: 20, total: 1 });
    }
    const page = Number(search.get("page"));
    const data = page === 1 ? [row(1, null), row(2, "2026-01-05T19:00:00.000Z")] : [row(21, "2026-01-05T19:00:00.000Z")];
    return HttpResponse.json({ data, page, pageSize: 20, total: 21 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  requests.length = 0;
});
afterAll(() => server.close());

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <NotificationsPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

describe("opening a notification", () => {
  it("a site check-in goes to the Site visits page", async () => {
    const visitRow: NotificationDto = {
      ...row(1, null),
      type: "SITE_CHECKED_IN",
      title: "Site check-in",
      body: "Alex Silva checked in at Site X, 10:42",
      relatedEntityType: "SiteVisit",
      relatedEntityId: "v1",
    };
    server.use(
      http.get("/api/v1/notifications", () => HttpResponse.json({ data: [visitRow], page: 1, pageSize: 20, total: 1 })),
      http.patch("/api/v1/notifications/:id/read", () => HttpResponse.json({ notification: { ...visitRow, readAt: "2026-01-05T19:00:00.000Z" } })),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuthProvider>
            <NotificationsPage />
            <LocationProbe />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.setup().click(await screen.findByText("Alex Silva checked in at Site X, 10:42"));

    expect(screen.getByTestId("location").textContent).toBe("/site-visits");
  });
});

describe("NotificationsPage", () => {
  it("pages through results and filters to unread only", async () => {
    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByText("Notification 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: strings.table.next }));
    expect(await screen.findByText("Notification 21")).toBeInTheDocument();
    expect(requests.at(-1)?.get("page")).toBe("2");

    await user.click(screen.getByRole("tab", { name: strings.notifications.filterUnread(1) }));
    expect(await screen.findByText("Notification 1")).toBeInTheDocument();
    expect(screen.queryByText("Notification 2")).not.toBeInTheDocument();
    const last = requests.at(-1)!;
    expect(last.get("unreadOnly")).toBe("true");
    expect(last.get("page")).toBe("1"); // switching filter goes back to page 1
  });
});
