import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient";
import { AuthProvider } from "../lib/authContext";
import { ToastProvider } from "../lib/toast";
import { MyLeavePage } from "./MyLeavePage";
import { strings } from "../strings";

const server = setupServer(
  http.get("/api/v1/auth/me", () =>
    HttpResponse.json({
      user: { id: "u1", companyId: "c1", employeeId: "e1", email: "alex@acme.test", role: "EMPLOYEE", mustChangePassword: false },
    }),
  ),
  http.get("/api/v1/leave-balances/me", () => HttpResponse.json({ data: [] })),
  http.get("/api/v1/leave-types", () =>
    HttpResponse.json({ data: [{ id: "lt1", name: "Annual Leave", code: "ANNUAL", defaultAnnualDays: 14, requiresProof: false, carryForwardAllowed: false, allowPastDates: false }] }),
  ),
  http.get("/api/v1/leave-requests/me", () => HttpResponse.json({ data: [], page: 1, pageSize: 10, total: 0 })),
);

let previewCalls = 0;
let submitCalls = 0;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  previewCalls = 0;
  submitCalls = 0;
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <MyLeavePage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MyLeavePage apply form validation", () => {
  it("shows field errors and does not submit when leave type/dates are missing", async () => {
    server.use(
      http.post("/api/v1/leave-requests", () => {
        submitCalls++;
        return HttpResponse.json({ leaveRequest: {} }, { status: 201 });
      }),
    );

    renderPage();
    const user = userEvent.setup();

    await screen.findByText(strings.myLeave.apply);
    await user.click(screen.getByRole("button", { name: strings.myLeave.submit }));

    const dateErrors = await screen.findAllByText(/must be YYYY-MM-DD/i);
    expect(dateErrors.length).toBeGreaterThanOrEqual(2); // startDate and endDate both empty
    expect(submitCalls).toBe(0);
  });

  it("previews totalDays once a valid date range is entered", async () => {
    server.use(
      http.post("/api/v1/leave-requests/preview", () => {
        previewCalls++;
        return HttpResponse.json({ totalDays: 3 });
      }),
    );

    renderPage();
    const user = userEvent.setup();

    await screen.findByText(strings.myLeave.apply);
    await user.type(screen.getByLabelText(strings.myLeave.startDate), "2026-06-01");
    await user.type(screen.getByLabelText(strings.myLeave.endDate), "2026-06-03");

    await waitFor(() => expect(screen.getByText(`${strings.myLeave.totalDaysPreview}: 3`)).toBeInTheDocument());
    expect(previewCalls).toBeGreaterThan(0);
  });
});
