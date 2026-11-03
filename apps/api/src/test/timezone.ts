import { afterAll, beforeAll, expect } from "vitest";

/**
 * Runs the enclosing describe block with the Node process in a given
 * timezone. Node re-reads process.env.TZ when it is assigned at runtime, so
 * this genuinely changes the "server timezone" for Date's local-time
 * methods - the thing a UTC-hosted API would differ on from a laptop in
 * Colombo. Use with describe.each(TEST_TIMEZONES).
 */
export const TEST_TIMEZONES = [
  { tz: "Asia/Colombo", offsetMinutes: -330 },
  { tz: "UTC", offsetMinutes: 0 },
] as const;

export function useProcessTimezone(tz: string, offsetMinutes: number) {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.TZ;
    process.env.TZ = tz;
    // Guard: if the switch didn't take effect, fail loudly rather than
    // silently testing the same timezone twice.
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(offsetMinutes);
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
}
