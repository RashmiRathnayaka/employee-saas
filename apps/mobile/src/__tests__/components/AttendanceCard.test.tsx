import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Alert, Linking } from "react-native";
import * as ExpoLocation from "expo-location";
import * as SecureStore from "expo-secure-store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AttendanceRecordWithCoordinatesDto, AttendanceTodayDto } from "@employee-saas/shared";
import { AttendanceCard } from "../../components/AttendanceCard";
import { newClientRequestId } from "../../lib/attendance";
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
    router: { replace: jest.fn(), push: jest.fn() },
  };
});

process.env.EXPO_PUBLIC_API_URL = "http://localhost:4000/api/v1";

const SCHEDULE: AttendanceTodayDto["schedule"] = {
  dayType: "WORKING",
  isHalfDayLeave: false,
  // 09:00 and 17:00 in Colombo.
  scheduledStartAt: "2026-11-03T03:30:00.000Z",
  scheduledEndAt: "2026-11-03T11:30:00.000Z",
  lateGraceMinutes: 10,
};

/** The manual mock in __mocks__/expo-location.js. Imported, not jest.requireMock():
 * that returns a separate copy from the one the app's code gets. */
const Location = ExpoLocation as unknown as Record<
  "getForegroundPermissionsAsync" | "requestForegroundPermissionsAsync" | "getCurrentPositionAsync" | "getLastKnownPositionAsync",
  jest.Mock<(...args: unknown[]) => Promise<unknown>>
>;
const POSITION = { coords: { latitude: 6.9271, longitude: 79.8612, accuracy: 12 }, timestamp: Date.UTC(2026, 10, 3, 3, 30), mocked: false };
const permission = (status: string, canAskAgain = true) => ({ status, canAskAgain });

function makeRecord(overrides: Partial<AttendanceRecordWithCoordinatesDto> = {}): AttendanceRecordWithCoordinatesDto {
  return {
    id: "r1",
    employeeId: "e1",
    workDate: "2026-11-03",
    status: "PRESENT",
    scheduledStartAt: SCHEDULE.scheduledStartAt,
    scheduledEndAt: SCHEDULE.scheduledEndAt,
    checkInAt: "2026-11-03T03:32:00.000Z", // 09:02
    checkOutAt: null,
    workedMinutes: null,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    checkInSiteId: null,
    checkInAccuracyM: null,
    checkInDistanceM: null,
    checkInWithinRadius: null,
    checkInMocked: null,
    checkOutAccuracyM: null,
    checkOutDistanceM: null,
    checkOutWithinRadius: null,
    checkOutMocked: null,
    flags: [],
    source: "MOBILE",
    autoClosedAt: null,
    isCorrected: false,
    createdAt: "2026-11-03T03:32:00.000Z",
    updatedAt: "2026-11-03T03:32:00.000Z",
    checkInLat: null,
    checkInLng: null,
    checkOutLat: null,
    checkOutLng: null,
    ...overrides,
  };
}

const ME_USER = { id: "u1", companyId: "c1", employeeId: "e1", email: "alex@acme.test", role: "EMPLOYEE", mustChangePassword: false };
const COMPANY = { id: "c1", name: "Acme", code: "ACME", status: "ACTIVE", timezone: "Asia/Colombo", logoUrl: null, primaryColor: null, createdAt: "2026-01-01T00:00:00.000Z" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let today: AttendanceTodayDto;
let checkInBodies: { clientRequestId: string; clientTime?: string; location?: unknown }[];
let checkOutBodies: { location?: unknown }[];
let onCheckIn: () => Response;
let onCheckOut: () => Response;
let onToday: () => Response;
let alertSpy: jest.SpiedFunction<typeof Alert.alert>;

const fetchMock = jest.fn(async (url: string | URL, init: RequestInit = {}) => {
  const method = (init.method ?? "GET").toUpperCase();
  const key = `${method} ${new URL(url).pathname.replace("/api/v1", "")}`;
  switch (key) {
    case "GET /auth/me":
      return jsonResponse({ user: ME_USER });
    case "GET /company":
      return jsonResponse({ company: COMPANY });
    case "GET /company/settings":
      return jsonResponse({ settings: { enabledModules: { attendance: true }, gpsRetentionDays: 45 } });
    case "GET /attendance/me/today":
      return onToday();
    case "POST /attendance/check-in":
      checkInBodies.push(JSON.parse(init.body as string));
      return onCheckIn();
    case "POST /attendance/check-out":
      checkOutBodies.push(JSON.parse(init.body as string));
      return onCheckOut();
    default:
      throw new Error(`Unhandled fetch in test: ${key}`);
  }
});

const networkFailure = () => {
  throw new TypeError("Network request failed");
};

const clients: QueryClient[] = [];

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  clients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AttendanceCard />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await SecureStore.deleteItemAsync("location.disclosureAcknowledged");
  today = { workDate: "2026-11-03", schedule: SCHEDULE, record: null, nextAction: "CHECK_IN", gpsRequired: false, officeSite: null, openVisit: null };
  checkInBodies = [];
  checkOutBodies = [];
  Location.getForegroundPermissionsAsync.mockReset().mockResolvedValue(permission("granted"));
  Location.requestForegroundPermissionsAsync.mockReset().mockResolvedValue(permission("granted"));
  Location.getCurrentPositionAsync.mockReset().mockResolvedValue(POSITION);
  Location.getLastKnownPositionAsync.mockReset().mockResolvedValue(null);
  onCheckIn =() => jsonResponse({ record: makeRecord() }, 201);
  onCheckOut = () => jsonResponse({ record: makeRecord() });
  onToday = () => jsonResponse(today);
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  // Presses the confirming button unless a test says otherwise.
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.style !== "cancel")?.onPress?.();
  });
});

afterEach(() => {
  onlineManager.setOnline(true);
  clients.splice(0).forEach((client) => client.clear());
  (jest.requireMock("expo-secure-store") as { __reset: () => void }).__reset();
  jest.restoreAllMocks();
});

describe("AttendanceCard", () => {
  describe("with an open site visit", () => {
    const OPEN_VISIT = { id: "v1", siteName: "Warehouse", checkInAt: "2026-11-03T05:00:00.000Z" };

    it("the check-out confirmation says the visit closes too", async () => {
      today = { ...today, record: makeRecord(), nextAction: "CHECK_OUT", openVisit: OPEN_VISIT };
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkOut }));

      expect(alertSpy.mock.calls[0]![1]).toBe(
        `${strings.attendance.checkOutConfirmMessage} ${strings.siteVisits.dayCheckOutClosesVisit("Warehouse")}`,
      );
    });

    it("before a check-in, a visit left open isn't named as what's being checked", async () => {
      today = { ...today, nextAction: "CHECK_IN", gpsRequired: true, officeSite: null, openVisit: OPEN_VISIT };
      await renderCard();

      expect(await screen.findByText(strings.location.checkedAtOffice)).toBeTruthy();
      expect(screen.queryByText(strings.location.checkedAtSite("Warehouse"))).toBeNull();
    });

    it("with no open visit, it's the plain confirmation", async () => {
      today = { ...today, record: makeRecord(), nextAction: "CHECK_OUT" };
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkOut }));

      expect(alertSpy.mock.calls[0]![1]).toBe(strings.attendance.checkOutConfirmMessage);
    });

    it("if only the visit's site checks location: names it, and reads the location at check-out", async () => {
      today = { ...today, record: makeRecord(), nextAction: "CHECK_OUT", gpsRequired: true, openVisit: OPEN_VISIT };
      await renderCard();

      expect(await screen.findByText(strings.location.checkedAtSite("Warehouse"))).toBeTruthy();

      fireEvent.press(screen.getByRole("button", { name: strings.attendance.checkOut }));
      await waitFor(() => expect(checkOutBodies).toHaveLength(1));

      expect(checkOutBodies[0]!.location).toBeTruthy();
    });
  });

  it("before check-in: shows the schedule in company time, and offers Check in", async () => {
    await renderCard();

    expect(await screen.findByText(`${strings.attendance.schedule}: 09:00 - 17:00`)).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.attendance.checkIn })).toBeTruthy();
    expect(screen.queryByRole("button", { name: strings.attendance.checkOut })).toBeNull();
  });

  it("checking in sends a request id, then the button becomes Check out", async () => {
    onCheckIn = () => {
      today = { ...today, record: makeRecord(), nextAction: "CHECK_OUT" };
      return jsonResponse({ record: makeRecord() }, 201);
    };
    await renderCard();

    fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkIn }));

    expect(await screen.findByRole("button", { name: strings.attendance.checkOut })).toBeTruthy();
    expect(screen.getByText(`${strings.attendance.checkedIn} 09:02`)).toBeTruthy();
    expect(screen.getByText(strings.attendanceStatus.PRESENT)).toBeTruthy();
    expect(checkInBodies).toHaveLength(1);
    expect(checkInBodies[0]!.clientRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it.each([
    [12, "Late by 12m"],
    [60, "Late by 1h"],
    [302, "Late by 5h 2m"],
  ])("shows %d minutes late on the chip as %s", async (lateMinutes, label) => {
    today = { ...today, record: makeRecord({ status: "LATE", lateMinutes }), nextAction: "CHECK_OUT" };
    await renderCard();

    expect(await screen.findByText(label)).toBeTruthy();
  });

  describe("confirming a check-out", () => {
    const checkOuts = () => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/attendance/check-out") && init?.method === "POST");

    beforeEach(() => {
      today = { ...today, record: makeRecord(), nextAction: "CHECK_OUT" };
    });

    it("tapping Check out only asks: nothing is sent yet", async () => {
      alertSpy.mockImplementation(() => undefined);
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkOut }));

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0]![1]).toMatch(/Are you sure you want to check out\?/);
      expect(checkOuts()).toHaveLength(0);
    });

    it("cancelling sends nothing, and the button stays", async () => {
      alertSpy.mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.style === "cancel")?.onPress?.());
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkOut }));

      expect(checkOuts()).toHaveLength(0);
      expect(screen.getByRole("button", { name: strings.attendance.checkOut })).toBeTruthy();
    });

    it("confirming checks out", async () => {
      onCheckOut = () => {
        today = { ...today, nextAction: "DONE", record: makeRecord({ checkOutAt: "2026-11-03T11:35:00.000Z", workedMinutes: 483 }) };
        return jsonResponse({ record: today.record });
      };
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkOut }));

      expect(await screen.findByText(strings.attendance.done)).toBeTruthy();
      expect(checkOuts()).toHaveLength(1);
    });

    it("a check-in doesn't ask", async () => {
      today = { ...today, record: null, nextAction: "CHECK_IN" };
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkIn }));

      await waitFor(() => expect(checkInBodies).toHaveLength(1));
      expect(alertSpy).not.toHaveBeenCalled();
    });
  });

  it("after check-out: shows the times and worked hours, and offers nothing", async () => {
    today = {
      ...today,
      nextAction: "DONE",
      record: makeRecord({ checkOutAt: "2026-11-03T11:35:00.000Z", workedMinutes: 483 }),
    };
    await renderCard();

    expect(await screen.findByText(`${strings.attendance.worked} 8h 3m`)).toBeTruthy();
    expect(screen.getByText(`${strings.attendance.checkedOut} 17:05`)).toBeTruthy();
    expect(screen.getByText(strings.attendance.done)).toBeTruthy();
    expect(screen.queryByRole("button", { name: strings.attendance.checkIn })).toBeNull();
    expect(screen.queryByRole("button", { name: strings.attendance.checkOut })).toBeNull();
  });

  it("a closed day offers nothing and says to ask HR", async () => {
    today = { ...today, nextAction: "DAY_CLOSED", record: makeRecord() };
    await renderCard();

    expect(await screen.findByText(strings.attendance.dayClosed)).toBeTruthy();
    expect(screen.queryByRole("button", { name: strings.attendance.checkOut })).toBeNull();
  });

  it.each([
    ["OFF" as const, strings.attendance.dayOff],
    ["HOLIDAY" as const, strings.attendance.holiday],
    ["ON_LEAVE" as const, strings.attendance.onLeave],
  ])("shows %s in the schedule line, and still allows a check-in", async (dayType, label) => {
    today = { ...today, schedule: { ...SCHEDULE, dayType } };
    await renderCard();

    expect(await screen.findByText(`${strings.attendance.schedule}: ${label}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.attendance.checkIn })).toBeTruthy();
  });

  describe("online only", () => {
    it("with no connection: says so, keeps the Check in button, and shows nothing as recorded", async () => {
      onCheckIn = networkFailure;
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkIn }));

      expect(await screen.findByText("No internet connection, try again")).toBeTruthy();
      expect(screen.getByRole("button", { name: strings.attendance.checkIn })).toBeTruthy();
      expect(screen.queryByText(strings.attendance.checkedIn, { exact: false })).toBeNull();
    });

    it("sends straight away even when the phone reports being offline, so nothing is queued for later", async () => {
      onCheckIn = networkFailure;
      await renderCard();
      const button = await screen.findByRole("button", { name: strings.attendance.checkIn });
      await act(async () => onlineManager.setOnline(false));

      fireEvent.press(button);

      // React Query's default would pause here and send when back online.
      expect(await screen.findByText("No internet connection, try again")).toBeTruthy();
      expect(checkInBodies).toHaveLength(1);

      // Coming back online must not send it again by itself.
      await act(async () => onlineManager.setOnline(true));
      expect(checkInBodies).toHaveLength(1);
    });

    it("a retry after a lost response resends the same id", async () => {
      onCheckIn = networkFailure;
      await renderCard();
      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkIn }));
      await screen.findByText("No internet connection, try again");

      onCheckIn = () => {
        today = { ...today, record: makeRecord(), nextAction: "CHECK_OUT" };
        return jsonResponse({ record: makeRecord() });
      };
      fireEvent.press(screen.getByRole("button", { name: strings.attendance.checkIn }));

      expect(await screen.findByRole("button", { name: strings.attendance.checkOut })).toBeTruthy();
      expect(checkInBodies).toHaveLength(2);
      expect(checkInBodies[1]!.clientRequestId).toBe(checkInBodies[0]!.clientRequestId);
      expect(screen.queryByText("No internet connection, try again")).toBeNull();
    });

    it("a definite refusal uses a new id next time", async () => {
      onCheckIn = () => jsonResponse({ error: { code: "DAY_ALREADY_CLOSED", message: "Closed" } }, 409);
      await renderCard();
      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkIn }));
      await screen.findByText(strings.errors.DAY_ALREADY_CLOSED);

      fireEvent.press(screen.getByRole("button", { name: strings.attendance.checkIn }));

      await waitFor(() => expect(checkInBodies).toHaveLength(2));
      expect(checkInBodies[1]!.clientRequestId).not.toBe(checkInBodies[0]!.clientRequestId);
    });

    it("a server error keeps the id, because the row may have been saved", async () => {
      onCheckIn = () => jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Boom" } }, 500);
      await renderCard();
      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkIn }));
      await screen.findByText("Boom");

      fireEvent.press(screen.getByRole("button", { name: strings.attendance.checkIn }));

      await waitFor(() => expect(checkInBodies).toHaveLength(2));
      expect(checkInBodies[1]!.clientRequestId).toBe(checkInBodies[0]!.clientRequestId);
    });

    it("checking out with no connection says so too", async () => {
      today = { ...today, record: makeRecord(), nextAction: "CHECK_OUT" };
      onCheckOut = networkFailure;
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkOut }));

      expect(await screen.findByText("No internet connection, try again")).toBeTruthy();
      expect(screen.getByRole("button", { name: strings.attendance.checkOut })).toBeTruthy();
    });
  });

  describe("location", () => {
    const SENT_LOCATION = { latitude: 6.9271, longitude: 79.8612, accuracy: 12, mocked: false, capturedAt: "2026-11-03T03:30:00.000Z" };
    const gpsToday = () => {
      today = { ...today, gpsRequired: true, officeSite: { id: "s1", name: "Head Office", radiusMeters: 200 } };
    };
    const pressCheckIn = async () => fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkIn }));

    it("reads nothing, and asks for nothing, when GPS isn't required", async () => {
      Location.getForegroundPermissionsAsync.mockResolvedValue(permission("undetermined"));
      await renderCard();

      await pressCheckIn();

      await waitFor(() => expect(checkInBodies).toHaveLength(1));
      expect(checkInBodies[0]).not.toHaveProperty("location");
      expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
      expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
      expect(screen.queryByText(strings.location.disclosureTitle)).toBeNull();
    });

    it("says the location is checked, and where", async () => {
      gpsToday();
      await renderCard();

      expect(await screen.findByText(strings.location.checkedAtSite("Head Office"))).toBeTruthy();
    });

    it("sends the location with the check-in when GPS is required", async () => {
      gpsToday();
      await renderCard();

      await pressCheckIn();

      await waitFor(() => expect(checkInBodies).toHaveLength(1));
      expect(checkInBodies[0]!.location).toEqual(SENT_LOCATION);
      expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
    });

    it("sends the location with the check-out, after the confirmation", async () => {
      gpsToday();
      today = { ...today, record: makeRecord(), nextAction: "CHECK_OUT" };
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkOut }));

      await waitFor(() => expect(checkOutBodies).toHaveLength(1));
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(checkOutBodies[0]!.location).toEqual(SENT_LOCATION);
    });

    describe("the first time, before the OS prompt", () => {
      beforeEach(() => {
        gpsToday();
        Location.getForegroundPermissionsAsync.mockResolvedValue(permission("undetermined"));
      });

      it("explains first, with the company's retention, and nothing has been asked or sent", async () => {
        await renderCard();

        await pressCheckIn();

        expect(await screen.findByText(strings.location.disclosureTitle)).toBeTruthy();
        expect(await screen.findByText(strings.location.retention(45))).toBeTruthy();
        expect(screen.getByText(/never track you in the background/)).toBeTruthy();
        expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
        expect(checkInBodies).toHaveLength(0);
      });

      it("Not now goes back: no prompt, no location, nothing sent", async () => {
        await renderCard();
        await pressCheckIn();

        fireEvent.press(await screen.findByRole("button", { name: strings.location.notNow }));

        await waitFor(() => expect(screen.queryByText(strings.location.disclosureTitle)).toBeNull());
        expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
        expect(checkInBodies).toHaveLength(0);
        expect(screen.getByRole("button", { name: strings.attendance.checkIn })).toBeTruthy();
      });

      it("Continue opens the OS prompt, then checks in with the location", async () => {
        await renderCard();
        await pressCheckIn();

        fireEvent.press(await screen.findByRole("button", { name: strings.location.continue }));

        await waitFor(() => expect(checkInBodies).toHaveLength(1));
        expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
        expect(checkInBodies[0]!.location).toEqual(SENT_LOCATION);
      });

      it("is shown only once", async () => {
        onCheckIn = () => jsonResponse({ error: { code: "OUTSIDE_SITE_RADIUS", message: "Too far" } }, 422);
        await renderCard();
        await pressCheckIn();
        fireEvent.press(await screen.findByRole("button", { name: strings.location.continue }));
        await waitFor(() => expect(checkInBodies).toHaveLength(1));
        await screen.findByRole("button", { name: strings.attendance.checkIn });

        await pressCheckIn();

        await waitFor(() => expect(checkInBodies).toHaveLength(2));
        expect(screen.queryByText(strings.location.disclosureTitle)).toBeNull();
      });

      it("isn't shown if location is already allowed", async () => {
        Location.getForegroundPermissionsAsync.mockResolvedValue(permission("granted"));
        await renderCard();

        await pressCheckIn();

        await waitFor(() => expect(checkInBodies).toHaveLength(1));
        expect(screen.queryByText(strings.location.disclosureTitle)).toBeNull();
      });
    });

    it("a refused permission still asks the server, and the refusal offers a way to settings", async () => {
      gpsToday();
      Location.getForegroundPermissionsAsync.mockResolvedValue(permission("denied", false));
      await acknowledgeLocationDisclosure();
      const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
      onCheckIn = () => jsonResponse({ error: { code: "LOCATION_REQUIRED", message: "Needed" } }, 422);
      await renderCard();

      await pressCheckIn();

      expect(await screen.findByText(strings.errors.LOCATION_REQUIRED)).toBeTruthy();
      expect(checkInBodies[0]).not.toHaveProperty("location");
      expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();

      fireEvent.press(screen.getByRole("button", { name: strings.location.openSettings }));
      expect(openSettings).toHaveBeenCalledTimes(1);
    });

    it("a refused permission doesn't stop a check-out", async () => {
      gpsToday();
      today = { ...today, record: makeRecord(), nextAction: "CHECK_OUT" };
      Location.getForegroundPermissionsAsync.mockResolvedValue(permission("denied", false));
      await acknowledgeLocationDisclosure();
      await renderCard();

      fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkOut }));

      await waitFor(() => expect(checkOutBodies).toHaveLength(1));
      expect(checkOutBodies[0]).not.toHaveProperty("location");
    });

    it.each([
      [850, "You are 850 m from Head Office."],
      [12300, "You are 12.3 km from Head Office."],
    ])("%d m outside the radius says how far, and from where", async (distanceM, message) => {
      gpsToday();
      onCheckIn = () => jsonResponse({ error: { code: "OUTSIDE_SITE_RADIUS", message: "Too far", details: { distanceM, radiusM: 200, siteName: "Head Office" } } }, 422);
      await renderCard();

      await pressCheckIn();

      expect(await screen.findByText(message)).toBeTruthy();
      expect(screen.queryByRole("button", { name: strings.location.openSettings })).toBeNull();
    });

    it("a mock location says so", async () => {
      gpsToday();
      onCheckIn = () => jsonResponse({ error: { code: "MOCK_LOCATION_DETECTED", message: "Mock" } }, 422);
      await renderCard();

      await pressCheckIn();

      expect(await screen.findByText(strings.errors.MOCK_LOCATION_DETECTED)).toBeTruthy();
    });
  });

  it("shows why a check-out was refused, and refreshes the card", async () => {
    today = { ...today, record: makeRecord(), nextAction: "CHECK_OUT" };
    onCheckOut = () => {
      today = { ...today, nextAction: "DAY_CLOSED" };
      return jsonResponse({ error: { code: "DAY_ALREADY_CLOSED", message: "Closed" } }, 409);
    };
    await renderCard();

    fireEvent.press(await screen.findByRole("button", { name: strings.attendance.checkOut }));

    expect(await screen.findByText(strings.errors.DAY_ALREADY_CLOSED)).toBeTruthy();
    expect(await screen.findByText(strings.attendance.dayClosed)).toBeTruthy();
  });

  it("disappears if the module was switched off after the screen loaded", async () => {
    onToday = () => jsonResponse({ error: { code: "MODULE_DISABLED", message: "Off" } }, 403);
    await renderCard();

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/attendance/me/today"))).toBe(true));
    await waitFor(() => expect(screen.queryByText(strings.attendance.title)).toBeNull());
  });
});

describe("newClientRequestId", () => {
  it("makes a valid uuid each time, and doesn't repeat", () => {
    const ids = new Set(Array.from({ length: 200 }, newClientRequestId));

    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
