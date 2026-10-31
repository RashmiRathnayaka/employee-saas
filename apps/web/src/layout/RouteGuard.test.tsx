import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Role } from "@employee-saas/shared";
import { queryClient } from "../lib/queryClient";
import { AuthProvider } from "../lib/authContext";
import { RequireAuth, RequireRole } from "./RouteGuard";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function mockMeAs(role: Role) {
  server.use(
    http.get("/api/v1/auth/me", () =>
      HttpResponse.json({
        user: { id: "u1", companyId: "c1", employeeId: "e1", email: "someone@acme.test", role, mustChangePassword: false },
      }),
    ),
  );
}

function renderGuarded(allowedRoles: Role[]) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/not-allowed" element={<div>Not allowed page</div>} />
              <Route element={<RequireRole roles={allowedRoles} />}>
                <Route path="/" element={<div>Secret page</div>} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RequireRole", () => {
  it("renders the page when the user's role is allowed", async () => {
    mockMeAs("MANAGER");
    renderGuarded(["MANAGER", "HR"]);

    expect(await screen.findByText("Secret page")).toBeInTheDocument();
  });

  it("redirects to /not-allowed when the user's role is not allowed", async () => {
    mockMeAs("EMPLOYEE");
    renderGuarded(["MANAGER", "HR"]);

    expect(await screen.findByText("Not allowed page")).toBeInTheDocument();
    expect(screen.queryByText("Secret page")).not.toBeInTheDocument();
  });
});
