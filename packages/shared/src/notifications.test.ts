import { describe, expect, it } from "vitest";
import { formatUnreadBadge, getNotificationTarget } from "./notifications.js";

describe("formatUnreadBadge", () => {
  it("hides the badge at 0, shows 1-9 as-is, and caps at 9+", () => {
    expect(formatUnreadBadge(0)).toBe("");
    expect(formatUnreadBadge(1)).toBe("1");
    expect(formatUnreadBadge(9)).toBe("9");
    expect(formatUnreadBadge(10)).toBe("9+");
    expect(formatUnreadBadge(250)).toBe("9+");
  });
});

describe("getNotificationTarget", () => {
  it.each([
    ["LeaveRequest", "leaveRequest"],
    ["AttendanceRecord", "attendance"],
    ["SiteVisit", "siteVisit"],
    ["Task", "task"],
  ])("maps %s to the %s target", (relatedEntityType, kind) => {
    expect(getNotificationTarget({ relatedEntityType, relatedEntityId: "r1" })).toEqual({ kind, id: "r1" });
  });

  it("returns null when there is no link", () => {
    expect(getNotificationTarget({ relatedEntityType: null, relatedEntityId: null })).toBeNull();
    expect(getNotificationTarget({ relatedEntityType: "LeaveRequest", relatedEntityId: null })).toBeNull();
    expect(getNotificationTarget({ relatedEntityType: "LeaveRequest", relatedEntityId: "" })).toBeNull();
    expect(getNotificationTarget({ relatedEntityType: null, relatedEntityId: "x" })).toBeNull();
  });

  it("returns null for an unknown type, including JS object built-ins", () => {
    expect(getNotificationTarget({ relatedEntityType: "Something", relatedEntityId: "x" })).toBeNull();
    expect(getNotificationTarget({ relatedEntityType: "constructor", relatedEntityId: "x" })).toBeNull();
  });
});
