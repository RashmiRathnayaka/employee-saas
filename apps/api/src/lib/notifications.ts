/** Same deliberately-loose client typing as lib/audit.ts - see the comment
 * there for why (Prisma's extended-client generics don't structurally
 * match PrismaClient | Prisma.TransactionClient). */
type NotificationClient = {
  notification: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
};

export type CreateNotificationInput = {
  companyId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
};

/** No endpoints read these yet (Step 1.7) - this just writes the row so
 * that work has data to read once it exists. */
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
