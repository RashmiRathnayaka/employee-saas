import { describe, expect, it } from "vitest";
import { haversineMeters } from "./geo.js";

// One degree along a meridian or the equator: 2 * pi * 6371000 / 360.
const ONE_DEGREE_METERS = 111_194.93;

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    const point = { latitude: 6.9271, longitude: 79.8612 };
    expect(haversineMeters(point, point)).toBe(0);
  });

  it("measures one degree of latitude", () => {
    expect(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(ONE_DEGREE_METERS, 1);
  });

  it("measures one degree of longitude at the equator", () => {
    expect(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(ONE_DEGREE_METERS, 1);
  });

  it("shrinks a degree of longitude away from the equator (half at 60 degrees)", () => {
    const distance = haversineMeters({ latitude: 60, longitude: 0 }, { latitude: 60, longitude: 1 });
    expect(distance).toBeCloseTo(ONE_DEGREE_METERS / 2, -1);
  });

  it("gives the same answer in both directions", () => {
    const colombo = { latitude: 6.9271, longitude: 79.8612 };
    const kandy = { latitude: 7.2906, longitude: 80.6337 };
    expect(haversineMeters(colombo, kandy)).toBe(haversineMeters(kandy, colombo));
  });

  it("matches a known real-world distance (London to Paris, about 344 km)", () => {
    const london = { latitude: 51.5074, longitude: -0.1278 };
    const paris = { latitude: 48.8566, longitude: 2.3522 };
    expect(haversineMeters(london, paris) / 1000).toBeCloseTo(343.6, 0);
  });

  it("is accurate at site-radius scale (about 200 m)", () => {
    const site = { latitude: 6.9271, longitude: 79.8612 };
    const degreesFor200m = 200 / ONE_DEGREE_METERS;
    const nearby = { latitude: 6.9271 + degreesFor200m, longitude: 79.8612 };
    expect(haversineMeters(site, nearby)).toBeCloseTo(200, 1);
  });

  it("takes the short way across the antimeridian", () => {
    const distance = haversineMeters({ latitude: 0, longitude: 179.5 }, { latitude: 0, longitude: -179.5 });
    expect(distance).toBeCloseTo(ONE_DEGREE_METERS, 1);
  });

  it("returns half the Earth's circumference for opposite points, not NaN", () => {
    const distance = haversineMeters({ latitude: 45, longitude: 0 }, { latitude: -45, longitude: 180 });
    expect(distance).toBeCloseTo(Math.PI * 6_371_000, 0);
  });
});
