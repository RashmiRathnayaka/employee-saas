import { Router } from "express";
import type { Notification } from "@prisma/client";
import { NotificationListQuerySchema, type NotificationDto } from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import {
  countUnread,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications.service.js";

export const notificationsRouter = Router();

// Any authenticated company user (every role) - each only ever reaches
// their own rows, enforced in the service. userId and companyId come only
// from the verified token (req.auth).
notificationsRouter.use("/notifications", requireAuth, requireCompanyContext);

function toNotificationDto(n: Notification): NotificationDto {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    relatedEntityType: n.relatedEntityType,
    relatedEntityId: n.relatedEntityId,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

notificationsRouter.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const query = NotificationListQuerySchema.parse(req.query);
    const { data, total } = await listNotifications({
      companyId: req.auth!.companyId!,
      userId: req.auth!.userId,
      ...query,
    });
    res.status(200).json({ data: data.map(toNotificationDto), page: query.page, pageSize: query.pageSize, total });
  }),
);

// Static paths are registered before "/notifications/:id/..." - see
// docs/architecture.md §3 on route order.
notificationsRouter.get(
  "/notifications/unread-count",
  asyncHandler(async (req, res) => {
    const count = await countUnread({ companyId: req.auth!.companyId!, userId: req.auth!.userId });
    res.status(200).json({ count });
  }),
);

notificationsRouter.patch(
  "/notifications/read-all",
  asyncHandler(async (req, res) => {
    const updated = await markAllNotificationsRead({ companyId: req.auth!.companyId!, userId: req.auth!.userId });
    res.status(200).json({ updated });
  }),
);

notificationsRouter.patch(
  "/notifications/:id/read",
  asyncHandler(async (req, res) => {
    const notification = await markNotificationRead({
      companyId: req.auth!.companyId!,
      userId: req.auth!.userId,
      notificationId: req.params.id!,
    });
    res.status(200).json({ notification: toNotificationDto(notification) });
  }),
);
