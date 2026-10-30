/**
 * Deliberately loose: the real callers are PrismaClient, a plain
 * transaction client, AND a getTenantPrisma()-extended client/transaction -
 * Prisma's generated generics for extended clients don't structurally match
 * PrismaClient | Prisma.TransactionClient, so this is typed by shape
 * instead of by Prisma's own (incompatible-across-extensions) client types.
 */
type AuditClient = {
  auditLog: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
};

export type WriteAuditInput = {
  companyId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: unknown;
};

export async function writeAudit(client: AuditClient, input: WriteAuditInput) {
  await client.auditLog.create({
    data: {
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as Record<string, unknown> | undefined,
    },
  });
}
