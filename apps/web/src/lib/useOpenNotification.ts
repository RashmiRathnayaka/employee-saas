import { useNavigate } from "react-router-dom";
import { getNotificationTarget, type NotificationDto } from "@employee-saas/shared";
import { useMarkNotificationRead } from "./notifications";

/** Opening a notification: mark it read (if it isn't already) and go to the
 * screen it points at. The navigation doesn't wait for the PATCH. If the
 * PATCH fails, the row just stays unread until the next refresh, which is
 * harmless. */
export function useOpenNotification() {
  const navigate = useNavigate();
  const markRead = useMarkNotificationRead();

  return (notification: NotificationDto) => {
    if (notification.readAt === null) markRead.mutate(notification.id);
    const target = getNotificationTarget(notification);
    if (target?.kind === "leaveRequest") navigate(`/leave-requests/${target.id}`);
  };
}
