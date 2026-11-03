import type { Prisma } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";

// Every query below filters by userId on top of the tenant client's
// automatic companyId filter: a user only ever sees their own
// notifications, inside their own company. Anything else is a 404 (not a
// 403), so the API never confirms another user's notification exists.

export async function listNotifications(params: {
  companyId: string;
  userId: string;
  page: number;
  pageSize: number;
  unreadOnly: boolean;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const where: Prisma.NotificationWhereInput = { userId: params.userId };
  if (params.unreadOnly) where.readAt = null;

  const [data, total] = await Promise.all([
    tenant.notification.findMany({
      where,
      // id as a tie-breaker keeps paging stable when two rows share a createdAt.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    tenant.notification.count({ where }),
  ]);
  return { data, total };
}

export async function countUnread(params: { companyId: string; userId: string }): Promise<number> {
  const tenant = getTenantPrisma(params.companyId);
  return tenant.notification.count({ where: { userId: params.userId, readAt: null } });
}

/** Idempotent: marking an already-read notification read again succeeds
 * and keeps the original readAt. */
export async function markNotificationRead(params: { companyId: string; userId: string; notificationId: string }) {
  const tenant = getTenantPrisma(params.companyId);
  const own = { id: params.notificationId, userId: params.userId };

  // Only touches the row while it's still unread, so a repeat call (or two
  // racing calls) never overwrites the first readAt.
  await tenant.notification.updateMany({ where: { ...own, readAt: null }, data: { readAt: new Date() } });

  const notification = await tenant.notification.findFirst({ where: own });
  if (!notification) {
    throw new ApiError(404, "NOT_FOUND", "Notification not found.");
  }
  return notification;
}

export async function markAllNotificationsRead(params: { companyId: string; userId: string }): Promise<number> {
  const tenant = getTenantPrisma(params.companyId);
  const result = await tenant.notification.updateMany({
    where: { userId: params.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
