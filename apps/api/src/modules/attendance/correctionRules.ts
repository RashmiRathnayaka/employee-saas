import { addDaysToIsoDate, formatDate, todayInTimezone } from "@employee-saas/shared";
import { ApiError } from "../../lib/errors.js";

/** The checks a correction of a record and of a visit share (§1.7). */

const ONE_HOUR_MS = 3_600_000;
/** A check-in and check-out further apart than this is a mistyped date, not a shift. */
const MAX_CORRECTED_SPAN_HOURS = 24;

export function cannotCorrectOwn() {
  return new ApiError(400, "CANNOT_CORRECT_OWN_ATTENDANCE", "You can't correct your own attendance. Ask someone else in HR.");
}

export function nothingToCorrect() {
  return new ApiError(400, "NOTHING_TO_CORRECT", "These are the values it already has.");
}

export function recordChanged() {
  return new ApiError(409, "RECORD_CHANGED", "This was changed a moment ago. Check it and try again.");
}

function invalid(field: string, message: string) {
  return new ApiError(400, "VALIDATION_ERROR", "Request validation failed", { formErrors: [], fieldErrors: { [field]: [message] } });
}

/**
 * Corrected times are never GPS-checked, so these are the only limits on them. They
 * have to be real, in order, and belong to the day being corrected. The dates are in
 * the company's timezone, which is the one the work date is in.
 */
export function assertCorrectedTimes(params: {
  checkInAt: Date;
  checkOutAt: Date | null;
  workDate: string;
  timezone: string;
  now: Date;
  /** A night shift's check-in can fall after midnight (§1.3). */
  allowNextDayCheckIn: boolean;
}): void {
  const { checkInAt, checkOutAt, workDate, timezone, now, allowNextDayCheckIn } = params;

  if (checkInAt > now) throw invalid("checkInAt", "Check-in can't be in the future");
  if (checkOutAt && checkOutAt > now) throw invalid("checkOutAt", "Check-out can't be in the future");

  const checkInDate = todayInTimezone(timezone, checkInAt);
  const onWorkDate = checkInDate === workDate;
  const onNextDay = allowNextDayCheckIn && checkInDate === addDaysToIsoDate(workDate, 1);
  if (!onWorkDate && !onNextDay) throw invalid("checkInAt", `Check-in must be on ${formatDate(workDate)}`);

  if (checkOutAt && checkOutAt <= checkInAt) throw invalid("checkOutAt", "Check-out must be after check-in");
  if (checkOutAt && checkOutAt.getTime() - checkInAt.getTime() > MAX_CORRECTED_SPAN_HOURS * ONE_HOUR_MS) {
    throw invalid("checkOutAt", `Check-out must be within ${MAX_CORRECTED_SPAN_HOURS} hours of check-in`);
  }
}
