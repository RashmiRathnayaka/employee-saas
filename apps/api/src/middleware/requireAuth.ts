import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/errors.js";
import type { RequestAuth } from "../lib/authTypes.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { platformPrisma } from "../lib/prisma.js";

const UNAUTHENTICATED = () => new ApiError(401, "UNAUTHENTICATED", "Invalid or expired session.");

// The one route a mustChangePassword=true user is still allowed to call.
// Matched against req.route.path, which is the route *pattern* a request
// matched (e.g. "/auth/change-password"), not the mount prefix - so this
// stays correct regardless of where the router is mounted.
const PASSWORD_CHANGE_ROUTE_PATH = "/auth/change-password";

function extractAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }
  const cookieToken = (req.cookies as Record<string, unknown> | undefined)?.accessToken;
  return typeof cookieToken === "string" ? cookieToken : null;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractAccessToken(req);
  if (!token) {
    next(UNAUTHENTICATED());
    return;
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).userId;
  } catch {
    next(UNAUTHENTICATED());
    return;
  }

  // Re-checked on every request (not just at login/token-issue time) so a
  // company suspension or user deactivation takes effect immediately, even
  // against an access token issued minutes earlier that hasn't expired yet.
  const user = await platformPrisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "ACTIVE") {
    next(UNAUTHENTICATED());
    return;
  }

  if (user.companyId) {
    const company = await platformPrisma.company.findUnique({ where: { id: user.companyId } });
    if (!company || company.status !== "ACTIVE") {
      next(UNAUTHENTICATED());
      return;
    }
  }

  if (user.mustChangePassword && req.route?.path !== PASSWORD_CHANGE_ROUTE_PATH) {
    next(new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "You must change your password before continuing."));
    return;
  }

  const auth: RequestAuth = {
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    employeeId: user.employeeId,
    mustChangePassword: user.mustChangePassword,
  };
  req.auth = auth;
  next();
}
