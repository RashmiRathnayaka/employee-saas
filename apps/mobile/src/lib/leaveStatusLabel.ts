import type { LeaveRequestDto } from "@employee-saas/shared";
import { strings } from "../strings";

/** Maps a leave request's raw status to the plain-language label shown on
 * status chips (e.g. PENDING_MANAGER -> "Waiting for manager"). */
export function leaveStatusLabel(status: LeaveRequestDto["status"]): string {
  return strings.leaveStatus[status];
}
