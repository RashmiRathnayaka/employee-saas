import { PrismaClient } from "@prisma/client";

/**
 * Unscoped Prisma client - sees every company's data with no filtering.
 * Reserved for: auth (looking up a user before we know which tenant client
 * to build), SUPER_ADMIN platform routes, and infrastructure (health check,
 * test helpers). Company-scoped module code must use getTenantPrisma()
 * from lib/tenantPrisma.ts instead - see docs/architecture.md §5.
 *
 * passwordHash is globally omitted from every User read, on every client
 * derived from this one (including getTenantPrisma()'s $extends wrapper and
 * any $transaction client) - a stray `select`-less query anywhere in the
 * codebase can never leak it. The handful of places that genuinely need it
 * (verifying a password at login/change-password) opt back in per-query
 * with `omit: { passwordHash: false }`.
 */
export const platformPrisma = new PrismaClient({
  omit: { user: { passwordHash: true } },
});
