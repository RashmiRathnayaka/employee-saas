import { formatDate, utcDateToIsoDate, type NotificationEntityType, type NotificationType } from "@employee-saas/shared";

/** Same deliberately-loose client typing as lib/audit.ts - see the comment
 * there for why (Prisma's extended-client generics don't structurally
 * match PrismaClient | Prisma.TransactionClient). */
type NotificationClient = {
  notification: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
};

type UserLookupClient = {
  user: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { id: true };
    }): Promise<{ id: string }[]>;
  };
};

export type CreateNotificationInput = {
  companyId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntityType: NotificationEntityType;
  relatedEntityId: string;
};

/** Writes one in-app notification row. Always called inside the same
 * transaction as the event it reports, so a rolled-back decision never
 * leaves a notification behind. Read via /api/v1/notifications. */
export async function createNotification(client: NotificationClient, input: CreateNotificationInput) {
  await client.notification.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
    },
  });
}

/** Active HR users of a company, minus `excludeUserId` (the requester - an
 * HR employee can't approve their own leave, so telling them it "awaits
 * your approval" would be wrong). */
export async function findActiveHrUserIds(
  client: UserLookupClient,
  params: { companyId: string; excludeUserId?: string | null },
): Promise<string[]> {
  const rows = await client.user.findMany({
    where: { companyId: params.companyId, role: "HR", status: "ACTIVE" },
    select: { id: true },
  });
  return rows.map((r) => r.id).filter((id) => id !== params.excludeUserId);
}

/** Sends the same notification to several users. */
export async function notifyUsers(
  client: NotificationClient,
  userIds: string[],
  input: Omit<CreateNotificationInput, "userId">,
) {
  for (const userId of userIds) {
    await createNotification(client, { ...input, userId });
  }
}

/** "02 Mar 2026 - 06 Mar 2026" (or a single date) for a leave's @db.Date range. */
export function leaveRangeText(startDate: Date, endDate: Date): string {
  const start = formatDate(utcDateToIsoDate(startDate));
  const end = formatDate(utcDateToIsoDate(endDate));
  return start === end ? start : `${start} - ${end}`;
}

/** Appends a reviewer's note to a notification body, when there is one. */
export function withNote(body: string, note: string | null | undefined, label = "Note"): string {
  const trimmed = note?.trim();
  return trimmed ? `${body} ${label}: "${trimmed}"` : body;
}
