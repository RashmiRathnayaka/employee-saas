import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import Index from "../../app/index";

jest.mock("expo-router", () => {
  // jest.mock factories run before the file's own imports (Jest hoists
  // them), so they can't reference top-level imports - require() here is
  // the standard workaround, not a stray import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return {
    Redirect: ({ href }: { href: string }) => React.createElement(Text, null, `REDIRECT:${href}`),
  };
});

// Jest's hoisting guard only allows out-of-scope variables whose name
// starts with "mock" (case-insensitive) inside a jest.mock() factory.
const mockUseAuth = jest.fn();
jest.mock("../../lib/authContext", () => ({
  useAuth: () => mockUseAuth(),
}));

describe("Index route guard", () => {
  it("redirects to /login when unauthenticated", async () => {
    mockUseAuth.mockReturnValue({ status: "unauthenticated", user: null });
    await render(<Index />);
    expect(screen.getByText("REDIRECT:/login")).toBeTruthy();
  });

  it("redirects to /change-password when mustChangePassword is true (forced change-password)", async () => {
    mockUseAuth.mockReturnValue({
      status: "authenticated",
      user: { id: "u1", companyId: "c1", employeeId: "e1", email: "a@acme.test", role: "EMPLOYEE", mustChangePassword: true },
    });
    await render(<Index />);
    expect(screen.getByText("REDIRECT:/change-password")).toBeTruthy();
  });

  it("redirects to /no-profile when the user has no employee profile", async () => {
    mockUseAuth.mockReturnValue({
      status: "authenticated",
      user: { id: "u1", companyId: "c1", employeeId: null, email: "admin@acme.test", role: "COMPANY_ADMIN", mustChangePassword: false },
    });
    await render(<Index />);
    expect(screen.getByText("REDIRECT:/no-profile")).toBeTruthy();
  });

  it("redirects to the tabs when fully authenticated with an employee profile", async () => {
    mockUseAuth.mockReturnValue({
      status: "authenticated",
      user: { id: "u1", companyId: "c1", employeeId: "e1", email: "a@acme.test", role: "EMPLOYEE", mustChangePassword: false },
    });
    await render(<Index />);
    expect(screen.getByText("REDIRECT:/(tabs)")).toBeTruthy();
  });
});
