import { describe, expect, it } from "vitest";
import pino from "pino";
import { redactOptions } from "./logger.js";

describe("logger redaction", () => {
  it("redacts the cookie and authorization request headers, and a Set-Cookie response header", () => {
    const lines: string[] = [];
    const testLogger = pino({ redact: redactOptions }, { write: (line: string) => lines.push(line) });

    const accessToken = "super-secret-access-token-value";
    const refreshToken = "super-secret-refresh-token-value";

    testLogger.info({
      req: {
        headers: {
          cookie: `accessToken=${accessToken}; refreshToken=${refreshToken}`,
          authorization: `Bearer ${accessToken}`,
        },
      },
      res: {
        headers: { "set-cookie": [`accessToken=${accessToken}; HttpOnly; Secure`] },
      },
    });

    const logged = lines.join("\n");
    expect(logged).not.toContain(accessToken);
    expect(logged).not.toContain(refreshToken);
    expect(logged).toContain("[REDACTED]");
  });

  describe("location fields", () => {
    // Distinctive values, so a match can only be a leaked coordinate.
    const LAT = 6.927123;
    const LNG = 79.861234;

    function logAndCapture(payload: Record<string, unknown>): string {
      const lines: string[] = [];
      pino({ redact: redactOptions }, { write: (line: string) => lines.push(line) }).info(payload, "event");
      return lines.join("\n");
    }

    it.each([
      ["top-level latitude/longitude", { latitude: LAT, longitude: LNG }],
      ["a location object", { location: { latitude: LAT, longitude: LNG, accuracy: 12 } }],
      ["coordinates one level down", { point: { latitude: LAT, longitude: LNG } }],
      ["a location object one level down", { attempt: { location: { latitude: LAT, longitude: LNG } } }],
      ["a request body's location", { req: { body: { location: { latitude: LAT, longitude: LNG } } } }],
      ["top-level column names", { checkInLat: LAT, checkInLng: LNG, checkOutLat: LAT, checkOutLng: LNG }],
      ["an attendance record's columns", { record: { checkInLat: LAT, checkInLng: LNG, checkOutLat: LAT, checkOutLng: LNG } }],
    ])("redacts %s", (_label, payload) => {
      const logged = logAndCapture(payload);
      expect(logged).not.toContain(String(LAT));
      expect(logged).not.toContain(String(LNG));
      expect(logged).toContain("[REDACTED]");
    });

    it("leaves non-location fields readable", () => {
      const logged = logAndCapture({ siteId: "site-1", record: { id: "rec-1", checkInLat: LAT } });
      expect(logged).toContain("site-1");
      expect(logged).toContain("rec-1");
    });
  });
});
