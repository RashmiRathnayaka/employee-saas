import { describe, expect, it } from "vitest";
import {
  AttendanceListQuerySchema,
  CheckInRequestSchema,
  CheckOutRequestSchema,
} from "./attendance.js";

const ID = "3f2b8c1e-5d4a-4f6b-9a7c-1e2d3c4b5a69";

describe("CheckInRequestSchema", () => {
  it("needs a uuid clientRequestId", () => {
    expect(CheckInRequestSchema.safeParse({ clientRequestId: ID }).success).toBe(true);
    expect(CheckInRequestSchema.safeParse({}).success).toBe(false);
    expect(CheckInRequestSchema.safeParse({ clientRequestId: "not-a-uuid" }).success).toBe(false);
  });

  it("drops anything the phone must not decide, and a location until GPS arrives", () => {
    const parsed = CheckInRequestSchema.parse({
      clientRequestId: ID,
      workDate: "2020-01-01",
      status: "PRESENT",
      checkInAt: "2020-01-01T00:00:00.000Z",
      location: { latitude: 6.9, longitude: 79.8 },
    });

    expect(parsed).toEqual({ clientRequestId: ID });
  });

  it("rejects a clientTime that isn't a timestamp", () => {
    expect(CheckInRequestSchema.safeParse({ clientRequestId: ID, clientTime: "yesterday" }).success).toBe(false);
    expect(CheckOutRequestSchema.safeParse({ clientTime: "2026-11-03T09:00:00.000Z" }).success).toBe(true);
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
