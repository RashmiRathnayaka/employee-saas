import argon2 from "argon2";
import type { AuthUser } from "@employee-saas/shared";
import type { RefreshToken, User } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { platformPrisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/jwt.js";
import { generateRefreshToken, hashRefreshToken, REFRESH_TOKEN_TTL_MS } from "../../lib/refreshToken.js";
import { writeAudit } from "../../lib/audit.js";

const genericLoginError = () =>
  new ApiError(401, "INVALID_CREDENTIALS", "Invalid company code, identifier, or password.");
const genericSessionError = () => new ApiError(401, "UNAUTHENTICATED", "Invalid or expired session.");

export function toAuthUser(user: Omit<User, "passwordHash">): AuthUser {
  return {
    id: user.id,
    companyId: user.companyId,
    employeeId: user.employeeId,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

type LoginParams = {
  companyCode: string;
  identifier: string;
  password: string;
  userAgent?: string;
};

type LoginTarget = {
  company: { id: string; status: string } | null;
  user: User | null;
};

async function resolveLoginTarget(companyCode: string, identifier: string): Promise<LoginTarget> {
  const company = await platformPrisma.company.findUnique({ where: { code: companyCode } });
  if (!company || company.status !== "ACTIVE") {
    return { company, user: null };
  }

  const employee = await platformPrisma.employee.findFirst({
    where: { companyId: company.id, employeeCode: identifier },
    include: { user: { omit: { passwordHash: false } } },
  });
  if (employee?.user) {
    return { company, user: employee.user };
  }

  const user = await platformPrisma.user.findFirst({
    where: { companyId: company.id, email: identifier },
    omit: { passwordHash: false },
  });
  return { company, user };
}

async function auditLoginFailure(params: {
  companyId: string | null;
  actorUserId: string | null;
  reason: string;
  identifier: string;
  companyCode?: string;
}) {
  await writeAudit(platformPrisma, {
    companyId: params.companyId,
    actorUserId: params.actorUserId,
    action: "LOGIN_FAILED",
    entityType: "User",
    entityId: params.actorUserId ?? "unknown",
    metadata: { reason: params.reason, identifier: params.identifier, companyCode: params.companyCode ?? null },
  });
}

export async function login(params: LoginParams) {
  const { companyCode, identifier, password, userAgent } = params;
  const { company, user } = await resolveLoginTarget(companyCode, identifier);

  if (!user) {
    await auditLoginFailure({
      companyId: company?.id ?? null,
      actorUserId: null,
      reason: company && company.status !== "ACTIVE" ? "company_suspended" : "not_found",
      identifier,
      companyCode,
    });
    throw genericLoginError();
  }

  const passwordOk = await argon2.verify(user.passwordHash, password);
  if (!passwordOk) {
    await auditLoginFailure({ companyId: user.companyId, actorUserId: user.id, reason: "wrong_password", identifier });
    throw genericLoginError();
  }

  if (user.status !== "ACTIVE") {
    await auditLoginFailure({ companyId: user.companyId, actorUserId: user.id, reason: "user_deactivated", identifier });
    throw genericLoginError();
  }

  const accessToken = signAccessToken({ userId: user.id, companyId: user.companyId, role: user.role });
  const { raw: refreshToken, hash } = generateRefreshToken();

  await platformPrisma.$transaction(async (tx) => {
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        userAgent,
      },
    });
    await writeAudit(tx, {
      companyId: user.companyId,
      actorUserId: user.id,
      action: "LOGIN_SUCCEEDED",
      entityType: "User",
      entityId: user.id,
    });
  });

  return { user, accessToken, refreshToken };
}

export async function platformLogin(params: { email: string; password: string; userAgent?: string }) {
  const { email, password, userAgent } = params;

  const user = await platformPrisma.user.findFirst({
    where: { companyId: null, email, role: "SUPER_ADMIN" },
    omit: { passwordHash: false },
  });

  if (!user) {
    await auditLoginFailure({ companyId: null, actorUserId: null, reason: "not_found", identifier: email });
    throw genericLoginError();
  }

  const passwordOk = await argon2.verify(user.passwordHash, password);
  if (!passwordOk) {
    await auditLoginFailure({ companyId: null, actorUserId: user.id, reason: "wrong_password", identifier: email });
    throw genericLoginError();
  }

  if (user.status !== "ACTIVE") {
    await auditLoginFailure({ companyId: null, actorUserId: user.id, reason: "user_deactivated", identifier: email });
    throw genericLoginError();
  }

  const accessToken = signAccessToken({ userId: user.id, companyId: user.companyId, role: user.role });
  const { raw: refreshToken, hash } = generateRefreshToken();

  await platformPrisma.$transaction(async (tx) => {
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        userAgent,
      },
    });
    await writeAudit(tx, {
      companyId: null,
      actorUserId: user.id,
      action: "PLATFORM_LOGIN_SUCCEEDED",
      entityType: "User",
      entityId: user.id,
    });
  });

  return { user, accessToken, refreshToken };
}

async function revokeTokenFamily(startTokenId: string) {
  let currentId: string | null = startTokenId;
  while (currentId) {
    const token: RefreshToken | null = await platformPrisma.refreshToken.findUnique({ where: { id: currentId } });
    if (!token) break;
    if (!token.revokedAt) {
      await platformPrisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    }
    currentId = token.replacedByTokenId;
  }
}

export async function refresh(params: { rawRefreshToken: string; userAgent?: string }) {
  const tokenHash = hashRefreshToken(params.rawRefreshToken);
  const tokenRow = await platformPrisma.refreshToken.findFirst({ where: { tokenHash } });

  if (!tokenRow) {
    throw genericSessionError();
  }

  if (tokenRow.revokedAt) {
    await revokeTokenFamily(tokenRow.id);
    throw genericSessionError();
  }

  if (tokenRow.expiresAt < new Date()) {
    throw genericSessionError();
  }

  const user = await platformPrisma.user.findUnique({ where: { id: tokenRow.userId } });
  if (!user || user.status !== "ACTIVE") {
    throw genericSessionError();
  }
  if (user.companyId) {
    const company = await platformPrisma.company.findUnique({ where: { id: user.companyId } });
    if (!company || company.status !== "ACTIVE") {
      throw genericSessionError();
    }
  }

  const accessToken = signAccessToken({ userId: user.id, companyId: user.companyId, role: user.role });
  const { raw: newRefreshToken, hash: newHash } = generateRefreshToken();

  await platformPrisma.$transaction(async (tx) => {
    const newTokenRow = await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        userAgent: params.userAgent,
      },
    });
    await tx.refreshToken.update({
      where: { id: tokenRow.id },
      data: { revokedAt: new Date(), replacedByTokenId: newTokenRow.id },
    });
  });

  return { user, accessToken, refreshToken: newRefreshToken };
}

export async function logout(rawRefreshToken: string | null) {
  if (!rawRefreshToken) return;
  const tokenHash = hashRefreshToken(rawRefreshToken);
  await platformPrisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function changePassword(params: { userId: string; currentPassword: string; newPassword: string }) {
  const user = await platformPrisma.user.findUnique({
    where: { id: params.userId },
    omit: { passwordHash: false },
  });
  if (!user) {
    throw new ApiError(404, "NOT_FOUND", "User not found.");
  }

  const ok = await argon2.verify(user.passwordHash, params.currentPassword);
  if (!ok) {
    throw new ApiError(400, "INVALID_PASSWORD", "Current password is incorrect.");
  }

  const newHash = await argon2.hash(params.newPassword);

  await platformPrisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: newHash, mustChangePassword: false } });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit(tx, {
      companyId: user.companyId,
      actorUserId: user.id,
      action: "PASSWORD_CHANGED",
      entityType: "User",
      entityId: user.id,
    });
  });
}
