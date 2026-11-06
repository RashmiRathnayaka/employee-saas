import { isModuleEnabled, type CompanyModule } from "@employee-saas/shared";
import { getTenantPrisma } from "./tenantPrisma.js";

const CACHE_TTL_MS = 30_000;

type CacheEntry = { enabledModules: unknown; expiresAt: number };

/**
 * companyId -> that company's module switches. Every request to a gated
 * router asks this, so without a cache each one would cost an extra query.
 *
 * The cache lives in this process only. The API instance that saves a change
 * drops its entry straight away; any other instance catches up when its entry
 * expires. So "off" can take up to 30 s to reach every instance. That's fine
 * for a setting an admin rarely changes.
 */
const cache = new Map<string, CacheEntry>();

async function getEnabledModules(companyId: string): Promise<unknown> {
  const cached = cache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached.enabledModules;

  const settings = await getTenantPrisma(companyId).companySettings.findUnique({
    where: { companyId },
    select: { enabledModules: true },
  });
  const enabledModules = settings?.enabledModules ?? null;
  cache.set(companyId, { enabledModules, expiresAt: Date.now() + CACHE_TTL_MS });
  return enabledModules;
}

/** Is this module on for the company? No settings row means off. */
export async function isCompanyModuleEnabled(companyId: string, module: CompanyModule): Promise<boolean> {
  return isModuleEnabled({ enabledModules: await getEnabledModules(companyId) }, module);
}

/** Call after a change to enabledModules has committed. Calling it earlier
 * would let another request re-cache the old value. */
export function invalidateEnabledModulesCache(companyId: string): void {
  cache.delete(companyId);
}
