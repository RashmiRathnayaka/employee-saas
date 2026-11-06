import type { AttendanceNextAction, SiteVisitFlag } from "@employee-saas/shared";

export type VisitDayEffect = {
  /** This visit also starts the attendance day (Q2). */
  startsDay: boolean;
  /** The existing record to link the visit to. It's never changed. */
  linkedRecordId: string | null;
  flags: SiteVisitFlag[];
};

/**
 * How a site check-in relates to the attendance day: architecture-phase2 §1.6. It's
 * a pure function so that every row of that section can be tested with plain values.
 *
 * `nextAction` already says whether the day has closed, so this can't disagree with
 * what the Home card offers or with what an office check-in would answer.
 */
export function getVisitDayEffect(params: {
  attendanceEnabled: boolean;
  nextAction: AttendanceNextAction;
  record: { id: string; status: string } | null;
}): VisitDayEffect {
  const { attendanceEnabled, nextAction, record } = params;

  // §0: with attendance off, a visit is just a visit.
  if (!attendanceEnabled) return { startsDay: false, linkedRecordId: null, flags: [] };

  switch (nextAction) {
    case "CHECK_IN":
      return { startsDay: true, linkedRecordId: null, flags: [] };
    case "CHECK_OUT":
      return { startsDay: false, linkedRecordId: record!.id, flags: [] };
    case "DONE":
      return { startsDay: false, linkedRecordId: record!.id, flags: ["AFTER_HOURS"] };
    case "DAY_CLOSED":
      // The system says they were absent and they were on site. It's for a person to
      // resolve, so it gets its own flag and the HR daily report shows it (§6).
      if (record?.status === "ABSENT") return { startsDay: false, linkedRecordId: record.id, flags: ["ON_ABSENT_DAY"] };
      // No record: the close time passed before day close wrote one. There's nothing to
      // link to, and an office check-in now would be refused, so this can't start the day.
      return { startsDay: false, linkedRecordId: record?.id ?? null, flags: ["AFTER_HOURS"] };
  }
}
