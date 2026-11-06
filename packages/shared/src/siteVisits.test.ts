import { describe, expect, it } from "vitest";
import { ATTENDANCE_FLAGS } from "./attendance.js";
import {
  MySiteVisitsQuerySchema,
  SITE_VISIT_FLAGS,
  SiteCheckInRequestSchema,
  SiteCheckOutRequestSchema,
  SiteVisitListQuerySchema,
  SiteVisitSchema,
  SiteVisitWithCoordinatesSchema,
} from "./siteVisits.js";

const ID = "3f2b8c1e-5d4a-4f6b-9a7c-1e2d3c4b5a69";
const OTHER_ID = "7c1d9e2a-4b3f-4e8d-8a6b-2f1e0d9c8b7a";
const LOCATION = { latitude: 6.9271, longitude: 79.8612, accuracy: 12.5, mocked: false, capturedAt: "2026-11-03T03:30:00.000Z" };

describe("SiteCheckInRequestSchema", () => {
  it("needs a site and a request id, both uuids", () => {
    expect(SiteCheckInRequestSchema.safeParse({ siteId: ID, clientRequestId: OTHER_ID }).success).toBe(true);
    expect(SiteCheckInRequestSchema.safeParse({ clientRequestId: OTHER_ID }).success).toBe(false);
    expect(SiteCheckInRequestSchema.safeParse({ siteId: ID }).success).toBe(false);
    expect(SiteCheckInRequestSchema.safeParse({ siteId: "nope", clientRequestId: OTHER_ID }).success).toBe(false);
  });

  it("drops anything the phone must not decide, including a company", () => {
    const parsed = SiteCheckInRequestSchema.parse({
      siteId: ID,
      clientRequestId: OTHER_ID,
      companyId: OTHER_ID,
      workDate: "2020-01-01",
      checkInAt: "2020-01-01T00:00:00.000Z",
      flags: [],
    });

    expect(parsed).toEqual({ siteId: ID, clientRequestId: OTHER_ID });
  });

  it("keeps a location, and drops a distance the phone tries to add to it", () => {
    const parsed = SiteCheckInRequestSchema.parse({
      siteId: ID,
      clientRequestId: OTHER_ID,
      location: { ...LOCATION, distanceM: 0, withinRadius: true },
    });

    expect(parsed.location).toEqual(LOCATION);
  });

  it("limits a note to 500 characters and trims it", () => {
    const base = { siteId: ID, clientRequestId: OTHER_ID };
    expect(SiteCheckInRequestSchema.parse({ ...base, note: "  Gate 2  " }).note).toBe("Gate 2");
    expect(SiteCheckInRequestSchema.safeParse({ ...base, note: "x".repeat(500) }).success).toBe(true);
    expect(SiteCheckInRequestSchema.safeParse({ ...base, note: "x".repeat(501) }).success).toBe(false);
  });
});

describe("SiteCheckOutRequestSchema", () => {
  it("accepts an empty body", () => {
    expect(SiteCheckOutRequestSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a malformed location", () => {
    expect(SiteCheckOutRequestSchema.safeParse({ location: { ...LOCATION, latitude: 91 } }).success).toBe(false);
  });
});

describe("the list queries", () => {
  it.each([
    ["my visits", MySiteVisitsQuerySchema],
    ["all visits", SiteVisitListQuerySchema],
  ])("%s: defaults, a page size limit, and the 93-day range rule", (_name, schema) => {
    expect(schema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(schema.safeParse({ pageSize: "101" }).success).toBe(false);
    expect(schema.safeParse({ from: "2026-11-03", to: "2026-11-02" }).success).toBe(false);
    expect(schema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(false);
    expect(schema.safeParse({ from: "2026-11-01", to: "2026-11-30" }).success).toBe(true);
    expect(schema.safeParse({ from: "soon" }).success).toBe(false);
  });

  it('reads openOnly as a literal, so "false" is false', () => {
    expect(SiteVisitListQuerySchema.parse({ openOnly: "true" }).openOnly).toBe(true);
    expect(SiteVisitListQuerySchema.parse({ openOnly: "false" }).openOnly).toBe(false);
    expect(SiteVisitListQuerySchema.parse({}).openOnly).toBeUndefined();
    expect(SiteVisitListQuerySchema.safeParse({ openOnly: "yes" }).success).toBe(false);
  });

  it("needs uuids for the employee and site filters", () => {
    expect(SiteVisitListQuerySchema.safeParse({ employeeId: "x" }).success).toBe(false);
    expect(SiteVisitListQuerySchema.safeParse({ siteId: "x" }).success).toBe(false);
    expect(SiteVisitListQuerySchema.safeParse({ employeeId: ID, siteId: OTHER_ID }).success).toBe(true);
  });
});

describe("flags", () => {
  it("every GPS flag a shared rule can return also exists on attendance records", () => {
    const visitOnly = new Set(["AFTER_HOURS", "ON_ABSENT_DAY"]);
    const gpsFlags = SITE_VISIT_FLAGS.filter((flag) => !visitOnly.has(flag));

    expect(gpsFlags).toHaveLength(5);
    for (const flag of gpsFlags) expect(ATTENDANCE_FLAGS).toContain(flag);
  });

  it("the two day flags never reach an attendance record", () => {
    expect(ATTENDANCE_FLAGS).not.toContain("AFTER_HOURS");
    expect(ATTENDANCE_FLAGS).not.toContain("ON_ABSENT_DAY");
  });
});

describe("what a manager gets", () => {
  it("has no coordinate fields, and the owner's version adds only those", () => {
    const managerFields = Object.keys(SiteVisitSchema.shape);
    const ownerOnly = Object.keys(SiteVisitWithCoordinatesSchema.shape).filter((key) => !managerFields.includes(key));

    expect(managerFields.filter((key) => /lat|lng|longitude/i.test(key))).toEqual([]);
    expect(ownerOnly.sort()).toEqual(["checkInLat", "checkInLng", "checkOutLat", "checkOutLng"]);
  });
});
