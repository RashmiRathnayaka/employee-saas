import { z } from "zod";

/** Every in-app notification type the API writes. Clients switch on these
 * (e.g. for an icon); `relatedEntityType` + `relatedEntityId` say which
 * screen to open. */
export const NOTIFICATION_TYPES = [
  "LEAVE_REQUEST_SUBMITTED", // -> current approver (manager, or HR)
  "LEAVE_REQUEST_PENDING_HR", // -> HR, after the MANAGER step under MANAGER_THEN_HR
  "LEAVE_REQUEST_APPROVED", // -> employee
  "LEAVE_REQUEST_REJECTED", // -> employee
  "LEAVE_REQUEST_REVOKED", // -> employee
  "LEAVE_REQUEST_CANCELLED", // employee cancelled -> current approver(s); system cancelled (deactivation) -> employee
  "LEAVE_DOCUMENT_REVIEWED", // -> employee (includes the HR note)
  "SITE_CHECKED_IN", // -> the employee's manager
  "ATTENDANCE_CORRECTED", // -> the employee, with the reason (a record or a site visit)
  "ATTENDANCE_AUTO_CLOSED", // day close -> the employee who didn't check out
  "SITE_VISIT_AUTO_CLOSED", // day close -> the employee who didn't check out of a visit
] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/** What a notification points at. Document reviews link to the document's
 * leave request, since that's the screen that shows documents. */
export const NOTIFICATION_ENTITY_TYPES = ["LeaveRequest", "AttendanceRecord", "SiteVisit", "Task"] as const;
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export const NotificationSchema = z.object({
  id: z.string(),
  type: z.string(), // a NotificationType; kept as string so an older client doesn't break on a new type
  title: z.string(),
  body: z.string(),
  relatedEntityType: z.string().nullable(),
  relatedEntityId: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof NotificationSchema>;

export const NotificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  // Literal "true"/"false" - z.coerce.boolean() would read "false" as true.
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const UnreadCountResponseSchema = z.object({ count: z.number().int().min(0) });
export type UnreadCountResponse = z.infer<typeof UnreadCountResponseSchema>;

export const MarkAllReadResponseSchema = z.object({ updated: z.number().int().min(0) });
export type MarkAllReadResponse = z.infer<typeof MarkAllReadResponseSchema>;

/** Badge text for an unread count: "" when there's nothing unread (hide
 * the badge), the number up to 9, then "9+". */
export function formatUnreadBadge(count: number): string {
  if (count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}

export type NotificationTarget = {
  kind: "leaveRequest" | "attendance" | "siteVisit" | "task";
  id: string;
};

/** What a notification should open, or null when it doesn't point at anything
 * (the apps then just mark it read and stay put). An app that has no screen
 * for a kind yet should do the same. */
export function getNotificationTarget(
  n: Pick<NotificationDto, "relatedEntityType" | "relatedEntityId">,
): NotificationTarget | null {
  if (!n.relatedEntityId) return null;
  switch (n.relatedEntityType) {
    case "LeaveRequest":
      return { kind: "leaveRequest", id: n.relatedEntityId };
    case "AttendanceRecord":
      return { kind: "attendance", id: n.relatedEntityId };
    case "SiteVisit":
      return { kind: "siteVisit", id: n.relatedEntityId };
    case "Task":
      return { kind: "task", id: n.relatedEntityId };
    default:
      return null;
  }
}
