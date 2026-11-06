import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { AppState, Linking } from "react-native";
import * as ExpoLocation from "expo-location";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LocationPrivacyScreen from "../../app/location-privacy";
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
  };
});

process.env.EXPO_PUBLIC_API_URL = "http://localhost:4000/api/v1";

const Location = ExpoLocation as unknown as {
  getForegroundPermissionsAsync: jest.Mock<() => Promise<unknown>>;
};
const ME_USER = { id: "u1", companyId: "c1", employeeId: "e1", email: "alex@acme.test", role: "EMPLOYEE", mustChangePassword: false };
const COMPANY = { id: "c1", name: "Acme", code: "ACME", status: "ACTIVE", timezone: "Asia/Colombo", logoUrl: null, primaryColor: null, createdAt: "2026-01-01T00:00:00.000Z" };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const fetchMock = jest.fn(async (url: string | URL) => {
  const path = new URL(url).pathname.replace("/api/v1", "");
  if (path === "/auth/me") return jsonResponse({ user: ME_USER });
  if (path === "/company") return jsonResponse({ company: COMPANY });
  if (path === "/company/settings") return jsonResponse({ settings: { enabledModules: {}, gpsRetentionDays: 60 } });
  throw new Error(`Unhandled fetch in test: ${path}`);
});

const clients: QueryClient[] = [];

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LocationPrivacyScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Location.getForegroundPermissionsAsync.mockReset().mockResolvedValue({ status: "granted", canAskAgain: true });
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  (jest.requireMock("expo-secure-store") as { __reset: () => void }).__reset();
  jest.restoreAllMocks();
});

describe("LocationPrivacyScreen", () => {
  it("shows the full disclosure, with the company's retention", async () => {
    await renderScreen();

    expect(await screen.findByText(strings.location.retention(60))).toBeTruthy();
    expect(screen.getByText(strings.location.disclosureTitle)).toBeTruthy();
    expect(screen.getByText(strings.location.disclosureIntro)).toBeTruthy();
    for (const point of strings.location.disclosurePoints) {
      expect(screen.getByText(point)).toBeTruthy();
    }
  });

  it.each([
    ["granted", strings.location.permission.GRANTED],
    ["denied", strings.location.permission.DENIED],
    ["undetermined", strings.location.permission.NOT_ASKED],
  ])("shows the OS permission when it's %s, and never prompts", async (status, label) => {
    Location.getForegroundPermissionsAsync.mockResolvedValue({ status, canAskAgain: true });
    await renderScreen();

    expect(await screen.findByText(label)).toBeTruthy();
  });

  it("links to system settings", async () => {
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    await renderScreen();

    fireEvent.press(await screen.findByRole("button", { name: strings.location.openSettings }));

    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("reads the permission again on coming back from settings", async () => {
    let onChange: (status: string) => void = () => undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      onChange = listener as (status: string) => void;
      return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
    });
    Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: false });
    await renderScreen();
    await screen.findByText(strings.location.permission.DENIED);

    Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted", canAskAgain: true });
    await act(async () => onChange("active"));

    expect(await screen.findByText(strings.location.permission.GRANTED)).toBeTruthy();
  });
});
