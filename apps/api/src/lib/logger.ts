import pino from "pino";
import { config } from "../config.js";

// pino-http logs req/res onto this same logger, including every header -
// cookie carries the access/refresh tokens (web), authorization carries the
// bearer access token (mobile), and a Set-Cookie response header would leak
// a freshly-issued token. Never log any of them in full.
//
// Coordinates are personal data with a retention limit, so they must not end
// up in logs either (docs/phase2/architecture-phase2.md §3.5). These paths are
// a safety net: pino can only match a fixed depth, so don't log a location
// object in the first place.
const LOCATION_FIELDS = ["latitude", "longitude", "location", "checkInLat", "checkInLng", "checkOutLat", "checkOutLng"];

export const redactOptions = {
  paths: [
    "req.headers.cookie",
    "req.headers.authorization",
    'res.headers["set-cookie"]',
    ...LOCATION_FIELDS,
    ...LOCATION_FIELDS.map((field) => `*.${field}`),
    "req.body.location",
  ],
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
