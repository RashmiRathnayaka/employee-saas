import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as ExpoLocation from "expo-location";
import * as SecureStore from "expo-secure-store";
import { getLocationPermissionState, readLocationForCheck, shouldShowLocationDisclosure } from "./location";
import { acknowledgeLocationDisclosure } from "./secureStore";

const Location = ExpoLocation as unknown as Record<
  "getForegroundPermissionsAsync" | "requestForegroundPermissionsAsync" | "getCurrentPositionAsync" | "getLastKnownPositionAsync",
  jest.Mock<(...args: unknown[]) => Promise<unknown>>
>;
const position = (extra: object = {}, coords: object = {}) => ({
  coords: { latitude: 6.9271, longitude: 79.8612, accuracy: 12, ...coords },
  timestamp: Date.UTC(2026, 10, 3, 3, 30),
  ...extra,
});
const permission = (status: string, canAskAgain = true) => ({ status, canAskAgain });

beforeEach(async () => {
  await SecureStore.deleteItemAsync("location.disclosureAcknowledged");
  Location.getForegroundPermissionsAsync.mockReset().mockResolvedValue(permission("granted"));
  Location.requestForegroundPermissionsAsync.mockReset().mockResolvedValue(permission("granted"));
  Location.getCurrentPositionAsync.mockReset().mockResolvedValue(position());
  Location.getLastKnownPositionAsync.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("getLocationPermissionState", () => {
  it.each([
    ["granted", "GRANTED"],
    ["denied", "DENIED"],
    ["undetermined", "NOT_ASKED"],
  ])("%s is %s", async (status, state) => {
    Location.getForegroundPermissionsAsync.mockResolvedValue(permission(status));
    await expect(getLocationPermissionState()).resolves.toBe(state);
  });
});

describe("shouldShowLocationDisclosure", () => {
  it("shows before the first prompt, and not after it's acknowledged", async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValue(permission("undetermined"));
    await expect(shouldShowLocationDisclosure()).resolves.toBe(true);

    await acknowledgeLocationDisclosure();
    await expect(shouldShowLocationDisclosure()).resolves.toBe(false);
  });

  it("doesn't show if location is already allowed", async () => {
    await expect(shouldShowLocationDisclosure()).resolves.toBe(false);
  });
});

describe("readLocationForCheck", () => {
  it("reads one high-accuracy fix", async () => {
    await expect(readLocationForCheck()).resolves.toEqual({
      latitude: 6.9271,
      longitude: 79.8612,
      accuracy: 12,
      mocked: false,
      capturedAt: "2026-11-03T03:30:00.000Z",
    });
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 4 });
  });

  it("passes on Android's mocked answer", async () => {
    Location.getCurrentPositionAsync.mockResolvedValue(position({ mocked: true }));
    await expect(readLocationForCheck()).resolves.toMatchObject({ mocked: true });
  });

  it("asks for permission when it can", async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValue(permission("undetermined"));

    await expect(readLocationForCheck()).resolves.not.toBeNull();
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("refused at the prompt: no location, and no attempt to read one", async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValue(permission("undetermined"));
    Location.requestForegroundPermissionsAsync.mockResolvedValue(permission("denied"));

    await expect(readLocationForCheck()).resolves.toBeNull();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("refused for good: doesn't ask again", async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValue(permission("denied", false));

    await expect(readLocationForCheck()).resolves.toBeNull();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it("GPS off: falls back to the last known fix, keeping its own time so the server can call it stale", async () => {
    Location.getCurrentPositionAsync.mockRejectedValue(new Error("Location services are disabled"));
    Location.getLastKnownPositionAsync.mockResolvedValue(position({ timestamp: Date.UTC(2026, 10, 3, 1, 0) }));

    await expect(readLocationForCheck()).resolves.toMatchObject({ capturedAt: "2026-11-03T01:00:00.000Z" });
  });

  it("after 15 seconds with no fix, falls back to the last known one", async () => {
    jest.useFakeTimers();
    Location.getCurrentPositionAsync.mockReturnValue(new Promise(() => undefined));
    Location.getLastKnownPositionAsync.mockResolvedValue(position());

    const read = readLocationForCheck();
    await jest.advanceTimersByTimeAsync(14_999);
    expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    await expect(read).resolves.not.toBeNull();
  });

  it("no fix of any kind: no location", async () => {
    Location.getCurrentPositionAsync.mockRejectedValue(new Error("No fix"));
    Location.getLastKnownPositionAsync.mockRejectedValue(new Error("No fix"));

    await expect(readLocationForCheck()).resolves.toBeNull();
  });

  it("a fix with no accuracy can't be judged, so it counts as none", async () => {
    Location.getCurrentPositionAsync.mockResolvedValue(position({}, { accuracy: null }));

    await expect(readLocationForCheck()).resolves.toBeNull();
  });
});
