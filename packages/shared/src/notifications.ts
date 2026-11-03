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
] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/** What a notification points at. Phase 1 only ever links to a leave
 * request (document reviews link to the document's leave request, since
 * that's the screen that shows documents). */
export const NOTIFICATION_ENTITY_TYPES = ["LeaveRequest"] as const;
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

/** The leave request a notification should open, or null when it doesn't
 * point at one (the apps then just mark it read and stay put). */
export function getNotificationLeaveRequestId(n: Pick<NotificationDto, "relatedEntityType" | "relatedEntityId">): string | null {
  return n.relatedEntityType === "LeaveRequest" && n.relatedEntityId ? n.relatedEntityId : null;
}
