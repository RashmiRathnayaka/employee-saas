import pino from "pino";
import { config } from "../config.js";

// pino-http logs req/res onto this same logger, including every header -
// cookie carries the access/refresh tokens (web), authorization carries the
// bearer access token (mobile), and a Set-Cookie response header would leak
// a freshly-issued token. Never log any of them in full.
export const redactOptions = {
  paths: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
  censor: "[REDACTED]",
};

export const logger = pino({
  level: config.NODE_ENV === "test" ? "silent" : "info",
  redact: redactOptions,
  transport:
    config.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
