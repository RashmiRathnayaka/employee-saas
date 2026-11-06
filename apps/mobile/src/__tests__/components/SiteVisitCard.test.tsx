import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Linking } from "react-native";
import * as ExpoLocation from "expo-location";
import * as SecureStore from "expo-secure-store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router } from "expo-router";
import type { OpenSiteVisitResponse, SiteVisitWithCoordinatesDto } from "@employee-saas/shared";
import { SiteVisitCard } from "../../components/SiteVisitCard";
import { AuthProvider } from "../../lib/authContext";
import { acknowledgeLocationDisclosure } from "../../lib/secureStore";
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

/** 10:30 in Colombo. */
const CHECKED_IN_AT = "2026-11-03T05:00:00.000Z";

function makeVisit(overrides: Partial<SiteVisitWithCoordinatesDto> = {}): SiteVisitWithCoordinatesDto {
  return {
    id: "v1",
    employeeId: "e1",
    employeeName: "Alex Silva",
    employeeCode: "EMP-1",
    siteId: "s1",
    siteName: "Warehouse",
    attendanceRecordId: "r1",
    workDate: "2026-11-03",
    status: "OPEN",
    checkInAt: CHECKED_IN_AT,
    checkOutAt: null,
    durationMinutes: null,
    checkInAccuracyM: null,
    checkInDistanceM: null,
    checkInWithinRadius: null,
    checkInMocked: null,
    checkOutAccuracyM: null,
    checkOutDistanceM: null,
    checkOutWithinRadius: null,
    checkOutMocked: null,
    flags: [],
    note: null,
    isCorrected: false,
    createdAt: CHECKED_IN_AT,
    updatedAt: CHECKED_IN_AT,
    checkInLat: null,
    checkInLng: null,
    checkOutLat: null,
    checkOutLng: null,
    ...overrides,
  };
}

let open: OpenSiteVisitResponse;
let onOpen: () => Response;
let onCheckOut: () => Response;
let checkOutRequests: { path: string; body: { location?: unknown } }[];
let openRequests: number;

const fetchMock = jest.fn(async (url: string | URL, init: RequestInit = {}) => {
  const method = (init.method ?? "GET").toUpperCase();
  const path = new URL(url).pathname.replace("/api/v1", "");
  if (method === "GET" && path === "/auth/me") return jsonResponse({ user: ME_USER });
  if (method === "GET" && path === "/company") return jsonResponse({ company: COMPANY });
  if (method === "GET" && path === "/company/settings") return jsonResponse({ settings: { enabledModules: { sites: true }, gpsRetentionDays: 45 } });
  if (method === "GET" && path === "/site-visits/me/open") {
    openRequests += 1;
    return onOpen();
  }
  if (method === "POST" && path.endsWith("/check-out")) {
    checkOutRequests.push({ path, body: JSON.parse(init.body as string) });
    return onCheckOut();
  }
  throw new Error(`Unhandled fetch in test: ${method} ${path}`);
});

const clients: QueryClient[] = [];

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  clients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SiteVisitCard />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await SecureStore.deleteItemAsync("location.disclosureAcknowledged");
  open = { visit: null, gpsRequired: false };
  onOpen = () => jsonResponse(open);
  onCheckOut = () => {
    open = { visit: null, gpsRequired: false };
    return jsonResponse({ visit: makeVisit({ status: "CLOSED" }) });
  };
  checkOutRequests = [];
  openRequests = 0;
  (router.push as jest.Mock).mockClear();
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

describe("SiteVisitCard", () => {
  describe("with no open visit", () => {
    it("offers Check in at a site, which opens the picker", async () => {
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.siteVisits.checkIn }));

      expect(router.push).toHaveBeenCalledWith("/site-picker");
      expect(screen.queryByRole("button", { name: strings.siteVisits.checkOut })).toBeNull();
    });

    it("My visits opens the list", async () => {
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.siteVisits.myVisits }));

      expect(router.push).toHaveBeenCalledWith("/my-visits");
    });
  });

  describe("with an open visit", () => {
    beforeEach(() => {
      open = { visit: makeVisit(), gpsRequired: false };
    });

    it("shows the banner in company time with how long it's been, and offers Check out", async () => {
      jest.spyOn(Date, "now").mockReturnValue(new Date(CHECKED_IN_AT).getTime() + 65 * 60_000);
      await renderCard();

      expect(await screen.findByText(strings.siteVisits.atSite("Warehouse"))).toBeTruthy();
      expect(screen.getByText(`${strings.siteVisits.since("10:30")} · 1h 5m`)).toBeTruthy();
      expect(screen.getByRole("button", { name: strings.siteVisits.checkOut })).toBeTruthy();
      expect(screen.queryByRole("button", { name: strings.siteVisits.checkIn })).toBeNull();
    });

    it("Check out closes it and goes back to offering a check-in", async () => {
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.siteVisits.checkOut }));

      expect(await screen.findByRole("button", { name: strings.siteVisits.checkIn })).toBeTruthy();
      expect(checkOutRequests).toEqual([{ path: "/site-visits/v1/check-out", body: {} }]);
      expect(openRequests).toBeGreaterThan(1);
    });

    it("a site that doesn't require GPS: the phone's location isn't read", async () => {
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.siteVisits.checkOut }));
      await screen.findByRole("button", { name: strings.siteVisits.checkIn });

      expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
      expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    });

    it("a site that requires GPS: the location goes with the tap", async () => {
      open = { visit: makeVisit(), gpsRequired: true };
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.siteVisits.checkOut }));
      await waitFor(() => expect(checkOutRequests).toHaveLength(1));

      expect(checkOutRequests[0]!.body.location).toMatchObject({ latitude: 6.9271, longitude: 79.8612, accuracy: 12, mocked: false });
    });

    it("a site that requires GPS with no location: the tap still goes, and the server flags it", async () => {
      open = { visit: makeVisit(), gpsRequired: true };
      await acknowledgeLocationDisclosure();
      Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: false });
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.siteVisits.checkOut }));
      await waitFor(() => expect(checkOutRequests).toHaveLength(1));

      expect(checkOutRequests[0]!.body.location).toBeUndefined();
    });

    it("the first time location is needed, it explains why before the OS asks", async () => {
      open = { visit: makeVisit(), gpsRequired: true };
      Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "undetermined", canAskAgain: true });
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.siteVisits.checkOut }));

      expect(await screen.findByText(strings.location.disclosureTitle)).toBeTruthy();
      expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
      expect(checkOutRequests).toHaveLength(0);

      fireEvent.press(screen.getByRole("button", { name: strings.location.notNow }));

      await waitFor(() => expect(screen.queryByText(strings.location.disclosureTitle)).toBeNull());
      expect(checkOutRequests).toHaveLength(0);

      fireEvent.press(screen.getByRole("button", { name: strings.siteVisits.checkOut }));
      fireEvent.press(await screen.findByRole("button", { name: strings.location.continue }));

      await waitFor(() => expect(checkOutRequests).toHaveLength(1));
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    });

    it("offline: says so and keeps the visit showing", async () => {
      onCheckOut = () => {
        throw new TypeError("Network request failed");
      };
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.siteVisits.checkOut }));

      expect(await screen.findByText(strings.attendance.offline)).toBeTruthy();
      expect(screen.getByRole("button", { name: strings.siteVisits.checkOut })).toBeTruthy();
    });

    it("a visit that has already closed elsewhere: a clear message, then the card catches up", async () => {
      onCheckOut = () => {
        open = { visit: null, gpsRequired: false };
        return jsonResponse({ error: { code: "VISIT_NOT_OPEN", message: "Closed" } }, 409);
      };
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.siteVisits.checkOut }));

      expect(await screen.findByText(strings.errors.VISIT_NOT_OPEN)).toBeTruthy();
      expect(await screen.findByRole("button", { name: strings.siteVisits.checkIn })).toBeTruthy();
    });

    it("the Open settings button isn't offered for an error it can't fix", async () => {
      const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
      onCheckOut = () => jsonResponse({ error: { code: "VISIT_NOT_OPEN", message: "Closed" } }, 409);
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.siteVisits.checkOut }));
      await screen.findByText(strings.errors.VISIT_NOT_OPEN);

      expect(screen.queryByRole("button", { name: strings.location.openSettings })).toBeNull();
      expect(openSettings).not.toHaveBeenCalled();
    });
  });

  it("hides itself if the module was switched off after the screen loaded", async () => {
    onOpen = () => jsonResponse({ error: { code: "MODULE_DISABLED", message: "Off" } }, 403);
    await renderCard();

    await waitFor(() => expect(openRequests).toBe(1));
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByText(strings.siteVisits.title)).toBeNull());
  });
});
