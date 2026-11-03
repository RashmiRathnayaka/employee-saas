import { currentYearInTimezone, DEFAULT_TIMEZONE, isoDateToUtcDate, todayInTimezone } from "@employee-saas/shared";
import { platformPrisma } from "./prisma.js";

/**
 * "Today" and "this year" for a company, in the company's own timezone
 * (`companies.timezone`) - never the server's. A server running in UTC
 * would otherwise think it's still yesterday for the first 5.5 hours of
 * every Colombo day (and still last year from 00:00 to 05:30 on 1 Jan).
 *
 * Read-only use of the `companies` table (platformPrisma, since `companies`
 * is the tenant root rather than a tenant-scoped table).
 */
export async function getCompanyTimezone(companyId: string): Promise<string> {
  const company = await platformPrisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  return company?.timezone ?? DEFAULT_TIMEZONE;
}

/** The company's today as a UTC-midnight Date (comparable to `@db.Date` columns). */
export function companyTodayAsUtcDate(timezone: string, now: Date = new Date()): Date {
  return isoDateToUtcDate(todayInTimezone(timezone, now));
}

export async function getCompanyCurrentYear(companyId: string, now: Date = new Date()): Promise<number> {
  return currentYearInTimezone(await getCompanyTimezone(companyId), now);
}
