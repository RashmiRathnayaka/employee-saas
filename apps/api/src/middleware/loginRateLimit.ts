import rateLimit from "express-rate-limit";
import { ApiError } from "../lib/errors.js";

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => `${req.ip}:${String((req.body as Record<string, unknown> | undefined)?.companyCode ?? "")}`,
  handler: (_req, _res, next) => {
    next(new ApiError(429, "RATE_LIMITED", "Too many login attempts. Try again later."));
  },
});

// Platform admin accounts can suspend/reactivate every company on the
// platform, so brute-forcing this login deserves a tighter limit than a
// regular company login - keyed by IP alone (there's no company code).
export const platformLoginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => String(req.ip),
  handler: (_req, _res, next) => {
    next(new ApiError(429, "RATE_LIMITED", "Too many login attempts. Try again later."));
  },
});
