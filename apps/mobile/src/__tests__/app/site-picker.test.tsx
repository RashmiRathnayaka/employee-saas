import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as ExpoLocation from "expo-location";
import * as SecureStore from "expo-secure-store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router } from "expo-router";
import type { SiteSummaryDto } from "@employee-saas/shared";
import SitePickerScreen from "../../app/site-picker";
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
    router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  };
});

process.env.EXPO_PUBLIC_API_URL = "http://localhost:4000/api/v1";

const Location = ExpoLocation as unknown as Record<
  "getForegroundPermissionsAsync" | "requestForegroundPermissionsAsync" | "getCurrentPositionAsync" | "getLastKnownPositionAsync",
  jest.Mock<(...args: unknown[]) => Promise<unknown>>
>;
const POSITION = { coords: { latitude: 6.9271, longitude: 79.8612, accuracy: 12 }, timestamp: Date.UTC(2026, 10, 3, 5, 0), mocked: false };

const ME_USER = { id: "u1", companyId: "c1", employeeId: "e1", email: "alex@acme.test", role: "EMPLOYEE", mustChangePassword: false };
const COMPANY = { id: "c1", name: "Acme", code: "ACME", status: "ACTIVE", timezone: "Asia/Colombo", logoUrl: null, primaryColor: null, createdAt: "2026-01-01T00:00:00.000Z" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const site = (id: string, name: string, extra: Partial<SiteSummaryDto> = {}): SiteSummaryDto => ({
  id,
  name,
  type: "EXTERNAL",
  address: null,
  gpsRequired: false,
  radiusMeters: 200,
  hasCoordinates: false,
  ...extra,
});
const WAREHOUSE = site("s1", "Warehouse", { address: "1 Galle Road" });
const GPS_SITE = site("s2", "Harbour", { gpsRequired: true, hasCoordinates: true });

type CheckInBody = { siteId: string; clientRequestId: string; location?: unknown };

let sites: SiteSummaryDto[];
let siteUrls: URL[];
let checkInBodies: CheckInBody[];
let onCheckIn: () => Response;

const fetchMock = jest.fn(async (input: string | URL, init: RequestInit = {}) => {
  const method = (init.method ?? "GET").toUpperCase();
  const url = new URL(input);
  const path = url.pathname.replace("/api/v1", "");
  if (method === "GET" && path === "/auth/me") return jsonResponse({ user: ME_USER });
  if (method === "GET" && path === "/company") return jsonResponse({ company: COMPANY });
  if (method === "GET" && path === "/company/settings") return jsonResponse({ settings: { enabledModules: { sites: true }, gpsRetentionDays: 45 } });
  if (method === "GET" && path === "/sites") {
    siteUrls.push(url);
    return jsonResponse({ data: sites, page: 1, pageSize: 20, total: sites.length });
  }
  if (method === "POST" && path === "/site-visits/check-in") {
    checkInBodies.push(JSON.parse(init.body as string));
    return onCheckIn();
  }
  throw new Error(`Unhandled fetch in test: ${method} ${path}`);
});

const clients: QueryClient[] = [];

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  clients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SitePickerScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const pick = async (name: string) => fireEvent.press(await screen.findByRole("button", { name }));

beforeEach(async () => {
  await SecureStore.deleteItemAsync("location.disclosureAcknowledged");
  sites = [WAREHOUSE, GPS_SITE];
  siteUrls = [];
  checkInBodies = [];
  onCheckIn = () => jsonResponse({ visit: { id: "v1" } }, 201);
  (router.back as jest.Mock).mockClear();
  Location.getForegroundPermissionsAsync.mockReset().mockResolvedValue({ status: "granted", canAskAgain: true });
  Location.requestForegroundPermissionsAsync.mockReset().mockResolvedValue({ status: "granted", canAskAgain: true });
  Location.getCurrentPositionAsync.mockReset().mockResolvedValue(POSITION);
  Location.getLastKnownPositionAsync.mockReset().mockResolvedValue(null);
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  (jest.requireMock("expo-secure-store") as { __reset: () => void }).__reset();
  jest.restoreAllMocks();
});

describe("the site picker", () => {
  it("lists external sites only, with what the employee needs to choose", async () => {
    await renderScreen();

    expect(await screen.findByText("Warehouse")).toBeTruthy();
    expect(screen.getByText("1 Galle Road")).toBeTruthy();
    expect(screen.getByText(strings.siteVisits.locationChecked)).toBeTruthy();
    expect(siteUrls[0]!.searchParams.get("type")).toBe("EXTERNAL");
  });

  it("searches on the server", async () => {
    await renderScreen();
    await screen.findByText("Warehouse");

    fireEvent.changeText(screen.getByLabelText(strings.siteVisits.search), " harb ");

    await waitFor(() => expect(siteUrls.at(-1)!.searchParams.get("q")).toBe("harb"));
    expect(siteUrls.at(-1)!.searchParams.get("type")).toBe("EXTERNAL");
  });

  it("no sites, and no matches, say different things", async () => {
    sites = [];
    await renderScreen();

    expect(await screen.findByText(strings.siteVisits.noSites)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText(strings.siteVisits.search), "zzz");

    expect(await screen.findByText(strings.siteVisits.noMatches)).toBeTruthy();
  });

  it("a tap checks in and goes back to Home", async () => {
    await renderScreen();

    await pick("Warehouse");

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(checkInBodies).toEqual([{ siteId: "s1", clientRequestId: expect.any(String) }]);
  });

  it("a site that doesn't require GPS: the phone's location isn't read", async () => {
    await renderScreen();

    await pick("Warehouse");
    await waitFor(() => expect(checkInBodies).toHaveLength(1));

    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it("a site that requires GPS: the location goes with the tap", async () => {
    await renderScreen();

    await pick("Harbour");
    await waitFor(() => expect(checkInBodies).toHaveLength(1));

    expect(checkInBodies[0]!.location).toMatchObject({ latitude: 6.9271, longitude: 79.8612, accuracy: 12, mocked: false });
  });

  it("the first time location is needed, it explains why. Not now sends nothing", async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "undetermined", canAskAgain: true });
    await renderScreen();

    await pick("Harbour");
    fireEvent.press(await screen.findByRole("button", { name: strings.location.notNow }));

    await waitFor(() => expect(screen.queryByText(strings.location.disclosureTitle)).toBeNull());
    expect(checkInBodies).toHaveLength(0);
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  it("Continue asks the OS, then checks in with the chosen site", async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "undetermined", canAskAgain: true });
    await renderScreen();

    await pick("Harbour");
    fireEvent.press(await screen.findByRole("button", { name: strings.location.continue }));

    await waitFor(() => expect(checkInBodies).toHaveLength(1));
    expect(checkInBodies[0]!.siteId).toBe("s2");
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  describe("refusals keep the picker open and say why", () => {
    it("another visit is open: names the site", async () => {
      onCheckIn = () =>
        jsonResponse({ error: { code: "VISIT_ALREADY_OPEN", message: "x", details: { visit: { id: "v9", siteName: "Depot" } } } }, 409);
      await renderScreen();

      await pick("Warehouse");

      expect(await screen.findByText(strings.siteVisits.checkOutFirst("Depot"))).toBeTruthy();
      expect(router.back).not.toHaveBeenCalled();
    });

    it("too far away: gives the distance", async () => {
      onCheckIn = () =>
        jsonResponse({ error: { code: "OUTSIDE_SITE_RADIUS", message: "x", details: { distanceM: 12300, radiusM: 200, siteName: "Harbour" } } }, 422);
      await renderScreen();

      await pick("Harbour");

      expect(await screen.findByText(strings.location.outsideRadius("12.3 km", "Harbour"))).toBeTruthy();
    });

    it("no location: explains, and offers Open settings", async () => {
      onCheckIn = () => jsonResponse({ error: { code: "LOCATION_REQUIRED", message: "x" } }, 422);
      await renderScreen();

      await pick("Harbour");

      expect(await screen.findByText(strings.errors.LOCATION_REQUIRED)).toBeTruthy();
      expect(screen.getByRole("button", { name: strings.location.openSettings })).toBeTruthy();
    });

    it("offline: says so", async () => {
      onCheckIn = () => {
        throw new TypeError("Network request failed");
      };
      await renderScreen();

      await pick("Warehouse");

      expect(await screen.findByText(strings.attendance.offline)).toBeTruthy();
    });
  });

  describe("retries", () => {
    const networkFailure = () => {
      throw new TypeError("Network request failed");
    };

    it("after a lost response, tapping the same site resends the same id", async () => {
      onCheckIn = networkFailure;
      await renderScreen();
      await pick("Warehouse");
      await screen.findByText(strings.attendance.offline);

      onCheckIn = () => jsonResponse({ visit: { id: "v1" } }, 200);
      await pick("Warehouse");
      await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));

      expect(checkInBodies[1]!.clientRequestId).toBe(checkInBodies[0]!.clientRequestId);
    });

    it("picking a different site instead is a new request, not a retry", async () => {
      onCheckIn = networkFailure;
      await renderScreen();
      await pick("Warehouse");
      await screen.findByText(strings.attendance.offline);

      onCheckIn = () => jsonResponse({ visit: { id: "v1" } }, 201);
      await pick("Harbour");
      await waitFor(() => expect(checkInBodies).toHaveLength(2));

      expect(checkInBodies[1]!.clientRequestId).not.toBe(checkInBodies[0]!.clientRequestId);
    });

    it("after a definite refusal, the next tap is a new request", async () => {
      onCheckIn = () => jsonResponse({ error: { code: "LOCATION_REQUIRED", message: "x" } }, 422);
      await renderScreen();
      await pick("Harbour");
      await screen.findByText(strings.errors.LOCATION_REQUIRED);

      await pick("Harbour");
      await waitFor(() => expect(checkInBodies).toHaveLength(2));

      expect(checkInBodies[1]!.clientRequestId).not.toBe(checkInBodies[0]!.clientRequestId);
    });
  });
});
