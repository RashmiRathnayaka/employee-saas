import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/errors.js";
import type { RequestAuth } from "../lib/authTypes.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { platformPrisma } from "../lib/prisma.js";

const UNAUTHENTICATED = () => new ApiError(401, "UNAUTHENTICATED", "Invalid or expired session.");

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

  const auth: RequestAuth = {
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    employeeId: user.employeeId,
  };
  req.auth = auth;
  next();
}
