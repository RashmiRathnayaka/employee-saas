import { describe, expect, it } from "@jest/globals";
import { leaveStatusLabel } from "./leaveStatusLabel";

describe("leaveStatusLabel", () => {
  it("maps every leave request status to its plain-language label", () => {
    expect(leaveStatusLabel("PENDING_MANAGER")).toBe("Waiting for manager");
    expect(leaveStatusLabel("PENDING_HR")).toBe("Waiting for HR");
    expect(leaveStatusLabel("APPROVED")).toBe("Approved");
    expect(leaveStatusLabel("REJECTED")).toBe("Rejected");
    expect(leaveStatusLabel("CANCELLED")).toBe("Cancelled");
    expect(leaveStatusLabel("REVOKED")).toBe("Revoked");
  });
});
