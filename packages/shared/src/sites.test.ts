import { describe, expect, it } from "vitest";
import {
  CreateSiteRequestSchema,
  getSiteLocationErrors,
  SiteListQuerySchema,
  UpdateSiteRequestSchema,
} from "./sites.js";

const valid = { name: "Head Office", type: "OFFICE" as const };

describe("CreateSiteRequestSchema", () => {
  const parse = (value: object) => CreateSiteRequestSchema.safeParse({ ...valid, ...value }).success;

  it("needs only a name and a type", () => {
    expect(parse({})).toBe(true);
  });

  it("rejects a blank name, a too-long name and an unknown type", () => {
    expect(parse({ name: "   " })).toBe(false);
    expect(parse({ name: "x".repeat(101) })).toBe(false);
    expect(parse({ type: "WAREHOUSE" })).toBe(false);
  });

  it.each([
    ["latitude", -90, 90],
    ["longitude", -180, 180],
  ])("enforces the range of %s", (field, min, max) => {
    expect(parse({ [field]: min })).toBe(true);
    expect(parse({ [field]: max })).toBe(true);
    expect(parse({ [field]: null })).toBe(true);
    expect(parse({ [field]: min - 0.1 })).toBe(false);
    expect(parse({ [field]: max + 0.1 })).toBe(false);
    expect(parse({ [field]: Number.NaN })).toBe(false);
    expect(parse({ [field]: "6.9" })).toBe(false);
  });

  it("enforces the radius range", () => {
    expect(parse({ radiusMeters: 25 })).toBe(true);
    expect(parse({ radiusMeters: 5000 })).toBe(true);
    expect(parse({ radiusMeters: 24 })).toBe(false);
    expect(parse({ radiusMeters: 5001 })).toBe(false);
    expect(parse({ radiusMeters: 200.5 })).toBe(false);
  });

  it("turns an emptied address into null", () => {
    expect(CreateSiteRequestSchema.parse({ ...valid, address: "   " }).address).toBeNull();
    expect(CreateSiteRequestSchema.parse({ ...valid, address: " Galle Rd " }).address).toBe("Galle Rd");
  });

  it("drops a companyId in the body", () => {
    expect(CreateSiteRequestSchema.parse({ ...valid, companyId: "other" })).not.toHaveProperty("companyId");
  });
});

describe("UpdateSiteRequestSchema", () => {
  it("leaves out fields that weren't sent, so a partial edit doesn't clear them", () => {
    const parsed = UpdateSiteRequestSchema.parse({ name: "New name" });
    expect(parsed.name).toBe("New name");
    expect(parsed.address ?? undefined).toBeUndefined();
    expect(parsed.latitude).toBeUndefined();
    expect(parsed.gpsRequired).toBeUndefined();
  });
});

describe("SiteListQuerySchema", () => {
  it("reads active as a real boolean", () => {
    expect(SiteListQuerySchema.parse({ active: "true" }).active).toBe(true);
    expect(SiteListQuerySchema.parse({ active: "false" }).active).toBe(false);
    expect(SiteListQuerySchema.parse({}).active).toBeUndefined();
    expect(SiteListQuerySchema.safeParse({ active: "yes" }).success).toBe(false);
  });

  it("caps the page size at 100", () => {
    expect(SiteListQuerySchema.safeParse({ pageSize: "100" }).success).toBe(true);
    expect(SiteListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });
});

describe("getSiteLocationErrors", () => {
  it("accepts both coordinates, or neither when GPS isn't required", () => {
    expect(getSiteLocationErrors({ latitude: 6.9, longitude: 79.8, gpsRequired: true })).toEqual({});
    expect(getSiteLocationErrors({ latitude: 6.9, longitude: 79.8, gpsRequired: false })).toEqual({});
    expect(getSiteLocationErrors({ latitude: null, longitude: null, gpsRequired: false })).toEqual({});
  });

  it("accepts a coordinate of exactly 0, which is a real position", () => {
    expect(getSiteLocationErrors({ latitude: 0, longitude: 0, gpsRequired: true })).toEqual({});
  });

  it("puts the error on the missing half of a position", () => {
    expect(Object.keys(getSiteLocationErrors({ latitude: 6.9, longitude: null, gpsRequired: false }))).toEqual(["longitude"]);
    expect(Object.keys(getSiteLocationErrors({ latitude: null, longitude: 79.8, gpsRequired: false }))).toEqual(["latitude"]);
  });

  it("requires coordinates when GPS is required", () => {
    expect(Object.keys(getSiteLocationErrors({ latitude: null, longitude: null, gpsRequired: true }))).toEqual(["latitude"]);
  });
});
