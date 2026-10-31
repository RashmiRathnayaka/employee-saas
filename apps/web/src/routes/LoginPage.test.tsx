import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient";
import { AuthProvider } from "../lib/authContext";
import { LoginPage } from "./LoginPage";
import { strings } from "../strings";

const server = setupServer(
  http.get("/api/v1/auth/me", () =>
    HttpResponse.json({ error: { code: "UNAUTHENTICATED", message: "nope" } }, { status: 401 }),
  ),
  // The bootstrap /auth/me call above 401s (no session yet), so apiClient's
  // refresh-once logic always tries this next - mock it so that's a clean,
  // expected "no session to restore" path rather than an unhandled request.
  http.post("/api/v1/auth/refresh", () =>
    HttpResponse.json({ error: { code: "UNAUTHENTICATED", message: "nope" } }, { status: 401 }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderLoginPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<div>Home page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  it("navigates home on a successful login", async () => {
    server.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json({
          user: { id: "u1", companyId: "c1", employeeId: null, email: "hr@acme.test", role: "HR", mustChangePassword: false },
        }),
      ),
    );

    renderLoginPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(strings.login.companyCode), "ACME");
    await user.type(screen.getByLabelText(strings.login.identifier), "hr@acme.test");
    await user.type(screen.getByLabelText(strings.login.password), "Passw0rd!");
    await user.click(screen.getByRole("button", { name: strings.login.submit }));

    await waitFor(() => expect(screen.getByText("Home page")).toBeInTheDocument());
  });

  it("shows a generic error message on failure, not the server's message", async () => {
    server.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json({ error: { code: "UNAUTHENTICATED", message: "Some specific server detail" } }, { status: 401 }),
      ),
    );

    renderLoginPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(strings.login.companyCode), "ACME");
    await user.type(screen.getByLabelText(strings.login.identifier), "hr@acme.test");
    await user.type(screen.getByLabelText(strings.login.password), "wrong");
    await user.click(screen.getByRole("button", { name: strings.login.submit }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(strings.login.genericError);
    expect(alert).not.toHaveTextContent("Some specific server detail");
  });
});
