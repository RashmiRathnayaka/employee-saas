/**
 * Test-only helper (not exported from the package index): runs a test
 * suite once per process timezone, so a date bug that only appears when
 * the server/device is east of UTC (Asia/Colombo, UTC+5:30) - or only on
 * a UTC server - fails in at least one run.
 *
 * Node re-reads `process.env.TZ` when it is assigned at runtime, so this
 * really changes how `new Date(y, m, d)`, `getDate()` etc. behave. Each run
 * asserts the switch took effect, so a silently-ignored TZ can't make the
 * suite pass by accident.
 */
export const TEST_TIMEZONES = [
  { tz: "Asia/Colombo", offsetMinutes: -330 }, // getTimezoneOffset() is minutes *behind* UTC
  { tz: "UTC", offsetMinutes: 0 },
] as const;

type EnvHolder = { env: Record<string, string | undefined> };

function processEnv(): Record<string, string | undefined> {
  return (globalThis as unknown as { process: EnvHolder }).process.env;
}

export function setProcessTimezone(tz: string | undefined): void {
  const env = processEnv();
  if (tz === undefined) delete env.TZ;
  else env.TZ = tz;
}

export function getProcessTimezone(): string | undefined {
  return processEnv().TZ;
}
