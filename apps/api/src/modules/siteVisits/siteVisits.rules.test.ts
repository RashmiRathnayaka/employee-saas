import { describe, expect, it } from "vitest";
import { getVisitDayEffect } from "./siteVisits.rules.js";

const record = (status: string) => ({ id: "r1", status });

describe("getVisitDayEffect: architecture-phase2 §1.6", () => {
  it.each([
    ["nothing recorded yet: starts the day", "CHECK_IN", null, { startsDay: true, linkedRecordId: null, flags: [] }],
    ["already checked in: only the visit", "CHECK_OUT", record("PRESENT"), { startsDay: false, linkedRecordId: "r1", flags: [] }],
    ["late and still checked in: only the visit", "CHECK_OUT", record("LATE"), { startsDay: false, linkedRecordId: "r1", flags: [] }],
    ["already checked out: after hours", "DONE", record("PRESENT"), { startsDay: false, linkedRecordId: "r1", flags: ["AFTER_HOURS"] }],
    ["auto-closed: after hours", "DAY_CLOSED", record("INCOMPLETE"), { startsDay: false, linkedRecordId: "r1", flags: ["AFTER_HOURS"] }],
    ["past its close time: after hours", "DAY_CLOSED", record("PRESENT"), { startsDay: false, linkedRecordId: "r1", flags: ["AFTER_HOURS"] }],
    ["day close wrote ON_LEAVE: after hours", "DAY_CLOSED", record("ON_LEAVE"), { startsDay: false, linkedRecordId: "r1", flags: ["AFTER_HOURS"] }],
    ["day close wrote HOLIDAY: after hours", "DAY_CLOSED", record("HOLIDAY"), { startsDay: false, linkedRecordId: "r1", flags: ["AFTER_HOURS"] }],
    ["day close wrote ABSENT: its own flag instead", "DAY_CLOSED", record("ABSENT"), { startsDay: false, linkedRecordId: "r1", flags: ["ON_ABSENT_DAY"] }],
    ["closed with no row yet: after hours, nothing to link", "DAY_CLOSED", null, { startsDay: false, linkedRecordId: null, flags: ["AFTER_HOURS"] }],
  ] as const)("%s", (_label, nextAction, row, expected) => {
    expect(getVisitDayEffect({ attendanceEnabled: true, nextAction, record: row })).toEqual(expected);
  });

  it.each(["CHECK_IN", "CHECK_OUT", "DONE", "DAY_CLOSED"] as const)(
    "with attendance off, %s changes nothing: a visit is just a visit",
    (nextAction) => {
      expect(getVisitDayEffect({ attendanceEnabled: false, nextAction, record: record("ABSENT") })).toEqual({
        startsDay: false,
        linkedRecordId: null,
        flags: [],
      });
    },
  );
});
