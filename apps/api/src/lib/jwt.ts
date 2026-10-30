import jwt from "jsonwebtoken";
import type { Role } from "@employee-saas/shared";
import { config } from "../config.js";

export type AccessTokenPayload = {
  userId: string;
  companyId: string | null;
  role: Role;
};

const ACCESS_TOKEN_TTL = "15m";

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload;
}
