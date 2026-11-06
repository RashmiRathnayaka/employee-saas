import { describe, expect, it } from "vitest";
import { chooseOffice, evaluateCheckInLocation, evaluateCheckOutLocation, type GpsSite } from "./gpsVerification.js";

const NOW = new Date("2026-11-03T04:00:00.000Z");
/** 0.001 degrees of latitude, at this latitude. */
const METERS_PER_MILLIDEGREE = 111.19;

const SITE: GpsSite = { id: "s1", name: "Head Office", latitude: 6.9271, longitude: 79.8612, radiusMeters: 200, gpsRequired: true };
const MAX_ACCURACY = 100;

/** A fix `metres` north of the site, as accurate as `accuracy`. */
function fixAt(metres: number, accuracy = 10, extra: object = {}) {
  return {
    latitude: SITE.latitude! + (metres / METERS_PER_MILLIDEGREE) * 0.001,
    longitude: SITE.longitude!,
    accuracy,
    mocked: false,
    capturedAt: NOW.toISOString(),
    ...extra,
  };
}

const checkIn = (location: ReturnType<typeof fixAt> | null, site = SITE) =>
  evaluateCheckInLocation({ site, location, maxAccuracyM: MAX_ACCURACY, now: NOW });
const checkOut = (location: ReturnType<typeof fixAt> | null, site = SITE) =>
  evaluateCheckOutLocation({ site, location, maxAccuracyM: MAX_ACCURACY, now: NOW });

describe("architecture-phase2 §3.2, at check-in", () => {
  it("no location: rejected", () => {
    expect(checkIn(null)).toEqual({ rejected: true, code: "LOCATION_REQUIRED" });
  });

  it("inside the radius with a good fix: accepted, no flags, and the reading is stored", () => {
    const result = checkIn(fixAt(50, 12.4));

    expect(result).toMatchObject({ rejected: false, flags: [] });
    if (result.rejected) throw new Error("expected acceptance");
    expect(result.reading).toMatchObject({ accuracyM: 12, withinRadius: true, mocked: false });
    expect(result.reading.distanceM).toBeGreaterThanOrEqual(49);
    expect(result.reading.distanceM).toBeLessThanOrEqual(51);
  });

  it("outside the radius with a good fix: rejected, saying how far and from where", () => {
    const result = checkIn(fixAt(850));

    expect(result).toMatchObject({ rejected: true, code: "OUTSIDE_SITE_RADIUS", radiusM: 200, siteName: "Head Office" });
    if (!result.rejected || result.code !== "OUTSIDE_SITE_RADIUS") throw new Error("expected a radius rejection");
    expect(Math.abs(result.distanceM - 850)).toBeLessThanOrEqual(1);
  });

  describe("poor accuracy", () => {
    it("certainly inside (the whole circle fits): accepted with no flag", () => {
      expect(checkIn(fixAt(50, 120))).toMatchObject({ rejected: false, flags: [] });
    });

    it("certainly outside (even the nearest point misses): rejected", () => {
      expect(checkIn(fixAt(500, 150))).toMatchObject({ rejected: true, code: "OUTSIDE_SITE_RADIUS" });
    });

    it("can't tell, centre inside: allowed and flagged", () => {
      const result = checkIn(fixAt(150, 120));

      expect(result).toMatchObject({ rejected: false, flags: ["LOW_ACCURACY"], reading: { withinRadius: true } });
    });

    it("can't tell, centre outside: allowed and flagged, and recorded as outside", () => {
      const result = checkIn(fixAt(250, 120));

      expect(result).toMatchObject({ rejected: false, flags: ["LOW_ACCURACY"], reading: { withinRadius: false } });
    });
  });

  it("a mock location: rejected, even at the right place", () => {
    expect(checkIn(fixAt(0, 5, { mocked: true }))).toEqual({ rejected: true, code: "MOCK_LOCATION_DETECTED" });
  });

  it("a stale fix: allowed and flagged", () => {
    const old = new Date(NOW.getTime() - 2 * 60_000 - 1).toISOString();

    expect(checkIn(fixAt(50, 10, { capturedAt: old }))).toMatchObject({ rejected: false, flags: ["STALE_LOCATION"] });
  });

  it("a stale fix can also be a poor one", () => {
    const old = new Date(NOW.getTime() - 10 * 60_000).toISOString();

    expect(checkIn(fixAt(150, 120, { capturedAt: old }))).toMatchObject({ flags: ["LOW_ACCURACY", "STALE_LOCATION"] });
  });
});

describe("the boundaries, at check-in", () => {
  /** Whole-metre positions, so these test the rule and not the rounding. */
  const site = { ...SITE, latitude: 0, longitude: 0, radiusMeters: 200 };
  const metresPerDegree = 111_194.93;
  const at = (metres: number, accuracy: number) => ({
    latitude: metres / metresPerDegree,
    longitude: 0,
    accuracy,
    mocked: false,
    capturedAt: NOW.toISOString(),
  });
  const run = (metres: number, accuracy: number) => checkIn(at(metres, accuracy), site);

  it("exactly on the radius is inside", () => {
    expect(run(200, 10)).toMatchObject({ rejected: false, flags: [], reading: { distanceM: 200 } });
  });

  it("one metre past the radius is outside", () => {
    expect(run(201, 10)).toMatchObject({ rejected: true, code: "OUTSIDE_SITE_RADIUS", distanceM: 201 });
  });

  it("an accuracy exactly at the limit is a good fix", () => {
    expect(run(201, 100)).toMatchObject({ rejected: true, code: "OUTSIDE_SITE_RADIUS" });
  });

  it("one metre over the limit is a poor fix", () => {
    expect(run(201, 101)).toMatchObject({ rejected: false, flags: ["LOW_ACCURACY"] });
  });

  it("a circle touching the edge from inside is certainly inside", () => {
    expect(run(50, 150)).toMatchObject({ rejected: false, flags: [] });
  });

  it("a circle one metre over the edge can't tell", () => {
    expect(run(51, 150)).toMatchObject({ rejected: false, flags: ["LOW_ACCURACY"] });
  });

  it("a circle just reaching the edge from outside can't tell", () => {
    expect(run(350, 150)).toMatchObject({ rejected: false, flags: ["LOW_ACCURACY"] });
  });

  it("a circle one metre short of the edge is certainly outside", () => {
    expect(run(351, 150)).toMatchObject({ rejected: true, code: "OUTSIDE_SITE_RADIUS" });
  });

  it("two minutes old exactly isn't stale", () => {
    const capturedAt = new Date(NOW.getTime() - 2 * 60_000).toISOString();

    expect(checkIn({ ...at(10, 10), capturedAt }, site)).toMatchObject({ flags: [] });
  });

  it("a capturedAt in the future isn't stale: the phone's clock is just ahead", () => {
    const capturedAt = new Date(NOW.getTime() + 60 * 60_000).toISOString();

    expect(checkIn({ ...at(10, 10), capturedAt }, site)).toMatchObject({ rejected: false, flags: [] });
  });
});

describe("architecture-phase2 §3.2, at check-out", () => {
  it("no location: allowed, flagged, nothing stored", () => {
    expect(checkOut(null)).toEqual({ reading: null, flags: ["LOCATION_UNAVAILABLE_AT_CHECKOUT"] });
  });

  it("inside with a good fix: no flags", () => {
    expect(checkOut(fixAt(50))).toMatchObject({ flags: [], reading: { withinRadius: true } });
  });

  it("outside with a good fix: allowed and flagged", () => {
    expect(checkOut(fixAt(850))).toMatchObject({ flags: ["OUTSIDE_RADIUS_AT_CHECKOUT"], reading: { withinRadius: false } });
  });

  it.each([
    ["certainly inside", 50, 120],
    ["can't tell", 150, 120],
    ["certainly outside", 500, 150],
  ])("poor accuracy is always just LOW_ACCURACY: %s", (_label, metres, accuracy) => {
    expect(checkOut(fixAt(metres, accuracy)).flags).toEqual(["LOW_ACCURACY"]);
  });

  it("a mock location: allowed and flagged, and the reading is kept", () => {
    expect(checkOut(fixAt(10, 5, { mocked: true }))).toMatchObject({
      flags: ["MOCK_LOCATION_AT_CHECKOUT"],
      reading: { mocked: true },
    });
  });

  it("a mock location outside gets both flags", () => {
    expect(checkOut(fixAt(850, 5, { mocked: true })).flags).toEqual(["MOCK_LOCATION_AT_CHECKOUT", "OUTSIDE_RADIUS_AT_CHECKOUT"]);
  });

  it("a stale fix: allowed and flagged", () => {
    const old = new Date(NOW.getTime() - 3 * 60_000).toISOString();

    expect(checkOut(fixAt(50, 10, { capturedAt: old })).flags).toEqual(["STALE_LOCATION"]);
  });
});

describe("chooseOffice", () => {
  const north = { ...SITE, id: "north", latitude: 7, longitude: 80 };
  const south = { ...SITE, id: "south", latitude: 6, longitude: 80 };
  const nearNorth = { latitude: 6.99, longitude: 80, accuracy: 10, mocked: false, capturedAt: NOW.toISOString() };
  const relaxed = (site: GpsSite) => ({ ...site, gpsRequired: false });

  it("no offices: no site and no check", () => {
    expect(chooseOffice([], nearNorth)).toEqual({ site: null, verify: false });
  });

  it("one office that doesn't require GPS: that office, and no check", () => {
    expect(chooseOffice([relaxed(north)], null)).toEqual({ site: relaxed(north), verify: false });
  });

  it("several that don't require GPS: no site, because the location isn't used to pick one", () => {
    expect(chooseOffice([relaxed(north), relaxed(south)], nearNorth)).toEqual({ site: null, verify: false });
  });

  it("one that requires GPS: that office, checked", () => {
    expect(chooseOffice([north], nearNorth)).toEqual({ site: north, verify: true });
  });

  it.each([
    ["first", [north, south]],
    ["last", [south, north]],
  ])("several that require GPS: the nearest, listed %s", (_label, offices) => {
    expect(chooseOffice(offices, nearNorth)).toEqual({ site: north, verify: true });
  });

  it("the nearest doesn't require GPS: that office, and no check", () => {
    expect(chooseOffice([relaxed(north), south], nearNorth)).toEqual({ site: relaxed(north), verify: false });
  });

  it("the nearest requires GPS, another doesn't: checked", () => {
    expect(chooseOffice([north, relaxed(south)], nearNorth)).toEqual({ site: north, verify: true });
  });

  it("an office with no coordinates can't be the nearest", () => {
    const noCoordinates = { ...relaxed(south), latitude: null, longitude: null };

    expect(chooseOffice([noCoordinates, north], nearNorth)).toEqual({ site: north, verify: true });
  });

  it("no location, with any office requiring GPS: needs one, so turning location off can't skip the check", () => {
    expect(chooseOffice([relaxed(north), south], null)).toEqual({ site: south, verify: true });
  });

  it("a mock next to an office that doesn't check still gets checked", () => {
    const mock = { ...nearNorth, mocked: true };

    expect(chooseOffice([relaxed(north), south], mock)).toEqual({ site: south, verify: true });
  });
});
