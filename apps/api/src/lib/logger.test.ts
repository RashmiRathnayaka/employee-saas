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
});
