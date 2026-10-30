import { Router } from "express";
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  type LoginResponse,
  type MeResponse,
  type RefreshResponse,
} from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ApiError } from "../../lib/errors.js";
import { platformPrisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { loginRateLimit } from "../../middleware/loginRateLimit.js";
import { validateBody } from "../../middleware/validate.js";
import { changePassword, login, logout, refresh, toAuthUser } from "./auth.service.js";
import { clearAuthCookies, getRefreshTokenFromRequest, isMobileClient, setAuthCookies } from "./cookies.js";

export const authRouter = Router();

function normalizeUserAgent(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

authRouter.post(
  "/auth/login",
  loginRateLimit,
  validateBody(LoginRequestSchema),
  asyncHandler(async (req, res) => {
    const { companyCode, identifier, password } = req.body;

    const { user, accessToken, refreshToken } = await login({
      companyCode,
      identifier,
      password,
      userAgent: normalizeUserAgent(req.headers["user-agent"]),
    });

    const body: LoginResponse = { user: toAuthUser(user) };

    if (isMobileClient(req)) {
      body.accessToken = accessToken;
      body.refreshToken = refreshToken;
    } else {
      setAuthCookies(res, { accessToken, refreshToken });
    }

    res.status(200).json(body);
  }),
);

authRouter.post(
  "/auth/refresh",
  asyncHandler(async (req, res) => {
    const rawRefreshToken = getRefreshTokenFromRequest(req);
    if (!rawRefreshToken) {
      throw new ApiError(401, "UNAUTHENTICATED", "Invalid or expired session.");
    }

    const { accessToken, refreshToken } = await refresh({
      rawRefreshToken,
      userAgent: normalizeUserAgent(req.headers["user-agent"]),
    });

    const body: RefreshResponse = {};

    if (isMobileClient(req)) {
      body.accessToken = accessToken;
      body.refreshToken = refreshToken;
    } else {
      setAuthCookies(res, { accessToken, refreshToken });
    }

    res.status(200).json(body);
  }),
);

authRouter.post(
  "/auth/logout",
  asyncHandler(async (req, res) => {
    const rawRefreshToken = getRefreshTokenFromRequest(req);
    await logout(rawRefreshToken);
    clearAuthCookies(res);
    res.status(200).json({ success: true });
  }),
);

authRouter.get(
  "/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await platformPrisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) {
      throw new ApiError(401, "UNAUTHENTICATED", "Invalid or expired session.");
    }
    const body: MeResponse = { user: toAuthUser(user) };
    res.status(200).json(body);
  }),
);

authRouter.post(
  "/auth/change-password",
  requireAuth,
  validateBody(ChangePasswordRequestSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    await changePassword({ userId: req.auth!.userId, currentPassword, newPassword });
    res.status(200).json({ success: true });
  }),
);
