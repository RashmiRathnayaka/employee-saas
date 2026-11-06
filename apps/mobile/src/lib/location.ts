import * as Location from "expo-location";
import type { LocationDto } from "@employee-saas/shared";
import { hasAcknowledgedLocationDisclosure } from "./secureStore";

/**
 * Everything the app does with location: architecture-phase2 §3.1. It reads one fix
 * when the employee taps, in the foreground. There's no watching and no background
 * task, and `app.json` leaves the background permission out of the build.
 */

const READ_TIMEOUT_MS = 15_000;

export type LocationPermissionState = "GRANTED" | "DENIED" | "NOT_ASKED";

export async function getLocationPermissionState(): Promise<LocationPermissionState> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status === Location.PermissionStatus.GRANTED) return "GRANTED";
  return status === Location.PermissionStatus.DENIED ? "DENIED" : "NOT_ASKED";
}

/** Google Play wants the explanation before the OS prompt, once. Someone who already
 * allowed location, for example in system settings, has nothing to be asked. */
export async function shouldShowLocationDisclosure(): Promise<boolean> {
  if ((await getLocationPermissionState()) === "GRANTED") return false;
  return !(await hasAcknowledgedLocationDisclosure());
}

async function ensurePermission(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.status === Location.PermissionStatus.GRANTED) return true;
  if (!current.canAskAgain) return false;
  const requested = await Location.requestForegroundPermissionsAsync();
  return requested.status === Location.PermissionStatus.GRANTED;
}

/** Resolves to null if the fix takes too long, or can't be had at all (GPS off). */
async function readWithTimeout(): Promise<Location.LocationObject | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readLastKnown(): Promise<Location.LocationObject | null> {
  try {
    return await Location.getLastKnownPositionAsync();
  } catch {
    return null;
  }
}

/**
 * The location to send with this tap, asking for permission if that's still allowed.
 * Null means none is available, and the tap still goes to the server, which decides
 * what that means: a refusal at check-in, a flag at check-out (§3.2).
 *
 * A fix with no accuracy can't be judged, so it counts as no fix. A last-known fix
 * keeps its own time, so the server can flag it as stale.
 */
export async function readLocationForCheck(): Promise<LocationDto | null> {
  if (!(await ensurePermission())) return null;

  const position = (await readWithTimeout()) ?? (await readLastKnown());
  if (!position || position.coords.accuracy === null) return null;

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    mocked: position.mocked ?? false,
    capturedAt: new Date(position.timestamp).toISOString(),
  };
}
