import { describe, expect, it } from "vitest";
import { formatUnreadBadge, getNotificationLeaveRequestId } from "./notifications.js";

describe("formatUnreadBadge", () => {
  it("hides the badge at 0, shows 1-9 as-is, and caps at 9+", () => {
    expect(formatUnreadBadge(0)).toBe("");
    expect(formatUnreadBadge(1)).toBe("1");
    expect(formatUnreadBadge(9)).toBe("9");
    expect(formatUnreadBadge(10)).toBe("9+");
    expect(formatUnreadBadge(250)).toBe("9+");
  });
});

describe("getNotificationLeaveRequestId", () => {
  it("returns the id for a LeaveRequest link, null otherwise", () => {
    expect(getNotificationLeaveRequestId({ relatedEntityType: "LeaveRequest", relatedEntityId: "r1" })).toBe("r1");
    expect(getNotificationLeaveRequestId({ relatedEntityType: null, relatedEntityId: null })).toBeNull();
    expect(getNotificationLeaveRequestId({ relatedEntityType: "Something", relatedEntityId: "x" })).toBeNull();
  });
});
