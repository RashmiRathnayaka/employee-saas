import { describe, expect, it } from "vitest";
import {
  AttendanceAdminListQuerySchema,
  AttendanceListQuerySchema,
  CheckInRequestSchema,
  CheckOutRequestSchema,
  CorrectAttendanceRequestSchema,
  CorrectSiteVisitRequestSchema,
  CreateAttendanceRequestSchema,
  LocationSchema,
} from "./attendance.js";

describe("the correction requests", () => {
  const AT = "2026-11-03T03:25:00.000Z";
  const LATER = "2026-11-03T11:30:00.000Z";

  describe.each([
    ["attendance", CorrectAttendanceRequestSchema],
    ["site visit", CorrectSiteVisitRequestSchema],
  ])("%s", (_name, schema) => {
    it("needs a reason of at least 5 characters, after trimming", () => {
      expect(schema.safeParse({ checkInAt: AT }).success).toBe(false);
      expect(schema.safeParse({ checkInAt: AT, reason: "  abcd  " }).success).toBe(false);
      expect(schema.parse({ checkInAt: AT, reason: "  Forgot  " }).reason).toBe("Forgot");
    });

    it("needs something to change", () => {
      expect(schema.safeParse({ reason: "Forgot to tap" }).success).toBe(false);
    });

    it("refuses a check-out at or before the check-in, on that field", () => {
      const result = schema.safeParse({ checkInAt: LATER, checkOutAt: AT, reason: "Forgot to tap" });

      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors.checkOutAt).toEqual(["Check-out must be after check-in"]);
      expect(schema.safeParse({ checkInAt: AT, checkOutAt: AT, reason: "Forgot to tap" }).success).toBe(false);
    });

    it("drops a status or a company, which HR can't set", () => {
      const parsed = schema.parse({ checkInAt: AT, reason: "Forgot to tap", status: "PRESENT", companyId: "x", isCorrected: false });

      expect(parsed).toEqual({ checkInAt: AT, reason: "Forgot to tap" });
    });
  });

  it("an office can be cleared with null, and that counts as a change", () => {
    expect(CorrectAttendanceRequestSchema.safeParse({ siteId: null, reason: "Wrong office" }).success).toBe(true);
  });

  it("a new record needs an employee, a date and a check-in", () => {
    const body = { employeeId: "11111111-1111-4111-8111-111111111111", workDate: "2026-11-03", checkInAt: AT, reason: "Forgot to tap" };
    expect(CreateAttendanceRequestSchema.safeParse(body).success).toBe(true);
    expect(CreateAttendanceRequestSchema.safeParse({ ...body, checkInAt: undefined }).success).toBe(false);
    expect(CreateAttendanceRequestSchema.safeParse({ ...body, workDate: "3 Nov" }).success).toBe(false);
    expect(CreateAttendanceRequestSchema.safeParse({ ...body, checkOutAt: AT }).success).toBe(false);
  });
});

describe("AttendanceAdminListQuerySchema", () => {
  it("takes one day, or a range, but not both", () => {
    expect(AttendanceAdminListQuerySchema.safeParse({ date: "2026-11-03" }).success).toBe(true);
    expect(AttendanceAdminListQuerySchema.safeParse({ from: "2026-11-01", to: "2026-11-30" }).success).toBe(true);
    expect(AttendanceAdminListQuerySchema.safeParse({ date: "2026-11-03", from: "2026-11-01" }).success).toBe(false);
  });

  it("keeps the 93-day limit and the page limit", () => {
    expect(AttendanceAdminListQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(false);
    expect(AttendanceAdminListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });

  it("refuses an unknown status or flag", () => {
    expect(AttendanceAdminListQuerySchema.safeParse({ status: "HERE" }).success).toBe(false);
    expect(AttendanceAdminListQuerySchema.safeParse({ flag: "NOPE" }).success).toBe(false);
  });
});

const ID = "3f2b8c1e-5d4a-4f6b-9a7c-1e2d3c4b5a69";
const LOCATION = { latitude: 6.9271, longitude: 79.8612, accuracy: 12.5, mocked: false, capturedAt: "2026-11-03T03:30:00.000Z" };

describe("CheckInRequestSchema", () => {
  it("needs a uuid clientRequestId", () => {
    expect(CheckInRequestSchema.safeParse({ clientRequestId: ID }).success).toBe(true);
    expect(CheckInRequestSchema.safeParse({}).success).toBe(false);
    expect(CheckInRequestSchema.safeParse({ clientRequestId: "not-a-uuid" }).success).toBe(false);
  });

  it("drops anything the phone must not decide", () => {
    const parsed = CheckInRequestSchema.parse({
      clientRequestId: ID,
      workDate: "2020-01-01",
      status: "PRESENT",
      checkInAt: "2020-01-01T00:00:00.000Z",
    });

    expect(parsed).toEqual({ clientRequestId: ID });
  });

  it("keeps a location, and drops a distance or an answer the phone tries to add to it", () => {
    const parsed = CheckInRequestSchema.parse({
      clientRequestId: ID,
      location: { ...LOCATION, distanceM: 0, withinRadius: true },
    });

    expect(parsed.location).toEqual(LOCATION);
  });

  it("rejects a clientTime that isn't a timestamp", () => {
    expect(CheckInRequestSchema.safeParse({ clientRequestId: ID, clientTime: "yesterday" }).success).toBe(false);
    expect(CheckOutRequestSchema.safeParse({ clientTime: "2026-11-03T09:00:00.000Z" }).success).toBe(true);
  });
});

describe("LocationSchema", () => {
  it.each([
    ["a latitude past the pole", { latitude: 90.1 }],
    ["a latitude past the other pole", { latitude: -90.1 }],
    ["a longitude past the date line", { longitude: 180.1 }],
    ["a longitude past it the other way", { longitude: -180.1 }],
    ["a negative accuracy", { accuracy: -1 }],
    ["an accuracy too big to store", { accuracy: 1_000_001 }],
    ["no mocked answer", { mocked: undefined }],
    ["a capturedAt that isn't a timestamp", { capturedAt: "just now" }],
  ])("rejects %s", (_label, change) => {
    expect(LocationSchema.safeParse({ ...LOCATION, ...change }).success).toBe(false);
  });

  it("accepts the edges of the map", () => {
    expect(LocationSchema.safeParse({ ...LOCATION, latitude: -90, longitude: 180, accuracy: 0 }).success).toBe(true);
  });

  it("is accepted on a check-out too", () => {
    expect(CheckOutRequestSchema.parse({ location: LOCATION }).location).toEqual(LOCATION);
  });
});

describe("AttendanceListQuerySchema", () => {
  it("defaults the page, and needs no dates", () => {
    expect(AttendanceListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it("caps the page size at 100", () => {
    expect(AttendanceListQuerySchema.safeParse({ pageSize: "100" }).success).toBe(true);
    expect(AttendanceListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });

  it.each([
    ["exactly 93 days", "2026-01-01", "2026-04-04", true],
    ["94 days", "2026-01-01", "2026-04-05", false],
    ["the same day", "2026-01-01", "2026-01-01", true],
    ["an end before the start", "2026-01-02", "2026-01-01", false],
  ])("%s", (_label, from, to, valid) => {
    expect(AttendanceListQuerySchema.safeParse({ from, to }).success).toBe(valid);
  });

  it("gives a malformed date its own error instead of throwing", () => {
    const result = AttendanceListQuerySchema.safeParse({ from: "03/11/2026", to: "2026-11-03" });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.from).toEqual(["Use a date like 2026-11-03"]);
  });
});
