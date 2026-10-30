import type { Request, Response } from "express";
import { config } from "../../config.js";
import { REFRESH_TOKEN_TTL_MS } from "../../lib/refreshToken.js";

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

export const ACCESS_COOKIE = "accessToken";
export const REFRESH_COOKIE = "refreshToken";

export function isMobileClient(req: Request): boolean {
  return req.header("X-Client") === "mobile";
}

export function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }) {
  const secure = config.NODE_ENV === "production";

  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_MS,
  });

  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/api/v1/auth",
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { path: "/" });
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
}

export function getRefreshTokenFromRequest(req: Request): string | null {
  if (isMobileClient(req)) {
    const raw = (req.body as Record<string, unknown> | undefined)?.refreshToken;
    return typeof raw === "string" ? raw : null;
  }
  const cookieToken = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof cookieToken === "string" ? cookieToken : null;
}
