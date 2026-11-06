import type { Site } from "@prisma/client";
import { haversineMeters, type AttendanceFlag, type LocationDto } from "@employee-saas/shared";

/**
 * The GPS rules as pure functions: architecture-phase2 §3.2. Nothing here reads the
 * clock or the database, so every row of that table can be tested with plain values.
 * Office attendance and site visits use the same rules, each with its own site.
 */

const STALE_AFTER_MS = 2 * 60_000;

/** The flags these rules can add. Attendance records and site visits both hold them. */
export type GpsFlag = Extract<
  AttendanceFlag,
  "LOW_ACCURACY" | "OUTSIDE_RADIUS_AT_CHECKOUT" | "MOCK_LOCATION_AT_CHECKOUT" | "LOCATION_UNAVAILABLE_AT_CHECKOUT" | "STALE_LOCATION"
>;

export type GpsSite = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  gpsRequired: boolean;
};

/** What gets stored for a fix. Decisions use these whole metres too, so a stored row
 * always explains its own outcome: 201 m against a 200 m radius is outside. */
export type GpsReading = {
  latitude: number;
  longitude: number;
  accuracyM: number;
  distanceM: number;
  withinRadius: boolean;
  mocked: boolean;
};

export function toGpsSite(site: Site): GpsSite {
  return {
    id: site.id,
    name: site.name,
    latitude: site.latitude?.toNumber() ?? null,
    longitude: site.longitude?.toNumber() ?? null,
    radiusMeters: site.radiusMeters,
    gpsRequired: site.gpsRequired,
  };
}

/** The columns a reading fills. Attendance records and site visits name them alike. */
export function checkInColumns(reading: GpsReading) {
  return {
    checkInLat: reading.latitude,
    checkInLng: reading.longitude,
    checkInAccuracyM: reading.accuracyM,
    checkInDistanceM: reading.distanceM,
    checkInWithinRadius: reading.withinRadius,
    checkInMocked: reading.mocked,
  };
}

export function checkOutColumns(reading: GpsReading) {
  return {
    checkOutLat: reading.latitude,
    checkOutLng: reading.longitude,
    checkOutAccuracyM: reading.accuracyM,
    checkOutDistanceM: reading.distanceM,
    checkOutWithinRadius: reading.withinRadius,
    checkOutMocked: reading.mocked,
  };
}

type Verification = {
  /** A GPS-required site always has coordinates: the database insists on it. */
  site: GpsSite;
  location: LocationDto;
  maxAccuracyM: number;
  now: Date;
};

function measure({ site, location }: Pick<Verification, "site" | "location">): GpsReading {
  const distanceM = Math.round(haversineMeters(location, { latitude: site.latitude!, longitude: site.longitude! }));
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    accuracyM: Math.round(location.accuracy),
    distanceM,
    withinRadius: distanceM <= site.radiusMeters,
    mocked: location.mocked,
  };
}

/** Only a fix older than the limit counts. A capturedAt in the future just means the
 * phone's clock is ahead, and the phone's clock is never trusted either way. */
function isStale(location: LocationDto, now: Date): boolean {
  return now.getTime() - new Date(location.capturedAt).getTime() > STALE_AFTER_MS;
}

export type CheckInGpsResult =
  | { rejected: true; code: "LOCATION_REQUIRED" | "MOCK_LOCATION_DETECTED" }
  | { rejected: true; code: "OUTSIDE_SITE_RADIUS"; distanceM: number; radiusM: number; siteName: string }
  | { rejected: false; reading: GpsReading; flags: GpsFlag[] };

/** The "At check-in" column of §3.2, for a site that requires GPS. */
export function evaluateCheckInLocation(params: Omit<Verification, "location"> & { location: LocationDto | null }): CheckInGpsResult {
  const { site, location, maxAccuracyM, now } = params;
  if (!location) return { rejected: true, code: "LOCATION_REQUIRED" };
  if (location.mocked) return { rejected: true, code: "MOCK_LOCATION_DETECTED" };

  const reading = measure({ site, location });
  const { distanceM, accuracyM } = reading;
  const radiusM = site.radiusMeters;
  const goodFix = accuracyM <= maxAccuracyM;

  // With a good fix, the distance is the answer. With a poor one, the fix could be
  // anywhere in a circle of `accuracyM` around it, so even its nearest point has to
  // miss the site before it counts as outside.
  const outside = goodFix ? distanceM > radiusM : distanceM - accuracyM > radiusM;
  if (outside) return { rejected: true, code: "OUTSIDE_SITE_RADIUS", distanceM, radiusM, siteName: site.name };

  const certainlyInside = goodFix || distanceM + accuracyM <= radiusM;
  const flags: GpsFlag[] = [];
  if (!certainlyInside) flags.push("LOW_ACCURACY");
  if (isStale(location, now)) flags.push("STALE_LOCATION");
  return { rejected: false, reading, flags };
}

/** The "At check-out" column of §3.2: problems only add flags, because a blocked
 * check-out would leave the record open and turn into a worse INCOMPLETE. */
export function evaluateCheckOutLocation(params: Omit<Verification, "location"> & { location: LocationDto | null }): {
  reading: GpsReading | null;
  flags: GpsFlag[];
} {
  const { site, location, maxAccuracyM, now } = params;
  if (!location) return { reading: null, flags: ["LOCATION_UNAVAILABLE_AT_CHECKOUT"] };

  const reading = measure({ site, location });
  const flags: GpsFlag[] = [];
  if (location.mocked) flags.push("MOCK_LOCATION_AT_CHECKOUT");
  if (reading.accuracyM > maxAccuracyM) flags.push("LOW_ACCURACY");
  else if (!reading.withinRadius) flags.push("OUTSIDE_RADIUS_AT_CHECKOUT");
  if (isStale(location, now)) flags.push("STALE_LOCATION");
  return { reading, flags };
}

function nearest(sites: GpsSite[], location: LocationDto): GpsSite {
  const distanceTo = (site: GpsSite) => haversineMeters(location, { latitude: site.latitude!, longitude: site.longitude! });
  return sites.reduce((best, site) => (distanceTo(site) < distanceTo(best) ? site : best));
}

/**
 * Which office a check-in belongs to, and whether its location gets checked (§2).
 * `offices` are the company's active offices. The site is null when there's no
 * office, or when several don't require GPS: with no location to compare (Q6), the
 * nearest can't be known and picking one would be a guess.
 *
 * If any office requires GPS, a tap without a location can't be placed, so it's
 * treated as needing one. Otherwise, turning location off would skip the check.
 */
export function chooseOffice(offices: GpsSite[], location: LocationDto | null): { site: GpsSite | null; verify: boolean } {
  const required = offices.filter((office) => office.gpsRequired);
  if (required.length === 0) return { site: offices.length === 1 ? offices[0]! : null, verify: false };
  if (!location) return { site: required[0]!, verify: true };

  // A mock can't choose where it is, or a fake position next to an office that
  // doesn't check would skip the check altogether.
  const candidates = location.mocked ? required : offices.filter((office) => office.latitude !== null);
  const site = nearest(candidates, location);
  return { site, verify: site.gpsRequired };
}
