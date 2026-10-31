import { describe, expect, it } from "vitest";
import type { AuthUser, LeaveRequestDto } from "@employee-saas/shared";
import { canDecideLeaveRequest } from "./leaveDecisionRules";

function makeRequest(overrides: Partial<LeaveRequestDto> = {}): LeaveRequestDto {
  return {
    id: "req-1",
    companyId: "c1",
    employeeId: "emp-requester",
    leaveTypeId: "lt-1",
    startDate: "2026-03-02",
    endDate: "2026-03-02",
    startHalfDay: false,
    endHalfDay: false,
    totalDays: 1,
    reason: null,
    status: "PENDING_MANAGER",
    proofStatus: "NOT_REQUIRED",
    proofDueAt: null,
    revokedAt: null,
    revokeNote: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "user-1",
    companyId: "c1",
    employeeId: "emp-manager",
    email: "someone@acme.test",
    role: "MANAGER",
    mustChangePassword: false,
    ...overrides,
  };
}

describe("canDecideLeaveRequest", () => {
  it("never allows deciding your own request, regardless of role or step", () => {
    const request = makeRequest({ employeeId: "emp-self", status: "PENDING_HR" });
    expect(canDecideLeaveRequest(request, makeUser({ role: "HR", employeeId: "emp-self" }))).toBe(false);
    expect(
      canDecideLeaveRequest(makeRequest({ employeeId: "emp-self", status: "PENDING_MANAGER" }), makeUser({ role: "MANAGER", employeeId: "emp-self" })),
    ).toBe(false);
  });

  it("lets a MANAGER decide only at the PENDING_MANAGER step", () => {
    const manager = makeUser({ role: "MANAGER", employeeId: "emp-manager" });
    expect(canDecideLeaveRequest(makeRequest({ status: "PENDING_MANAGER" }), manager)).toBe(true);
    expect(canDecideLeaveRequest(makeRequest({ status: "PENDING_HR" }), manager)).toBe(false);
  });

  it("lets HR decide at either PENDING_MANAGER (fallback) or PENDING_HR", () => {
    const hr = makeUser({ role: "HR", employeeId: "emp-hr" });
    expect(canDecideLeaveRequest(makeRequest({ status: "PENDING_MANAGER" }), hr)).toBe(true);
    expect(canDecideLeaveRequest(makeRequest({ status: "PENDING_HR" }), hr)).toBe(true);
    expect(canDecideLeaveRequest(makeRequest({ status: "APPROVED" }), hr)).toBe(false);
  });

  it("never lets COMPANY_ADMIN or EMPLOYEE decide", () => {
    expect(canDecideLeaveRequest(makeRequest({ status: "PENDING_HR" }), makeUser({ role: "COMPANY_ADMIN" }))).toBe(false);
    expect(canDecideLeaveRequest(makeRequest({ status: "PENDING_MANAGER" }), makeUser({ role: "EMPLOYEE" }))).toBe(false);
  });

  it("returns false with no user", () => {
    expect(canDecideLeaveRequest(makeRequest(), null)).toBe(false);
  });
});
