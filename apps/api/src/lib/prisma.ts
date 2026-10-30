import { PrismaClient } from "@prisma/client";

/**
 * Unscoped Prisma client - sees every company's data with no filtering.
 * Reserved for: auth (looking up a user before we know which tenant client
 * to build), SUPER_ADMIN platform routes, and infrastructure (health check,
 * test helpers). Company-scoped module code must use getTenantPrisma()
 * from lib/tenantPrisma.ts instead - see docs/architecture.md §5.
 */
export const platformPrisma = new PrismaClient();
