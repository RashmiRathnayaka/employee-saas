import type { Prisma, PrismaClient } from "@prisma/client";

type AuditClient = PrismaClient | Prisma.TransactionClient;

export type WriteAuditInput = {
  companyId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAudit(client: AuditClient, input: WriteAuditInput) {
  await client.auditLog.create({
    data: {
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
    },
  });
}
