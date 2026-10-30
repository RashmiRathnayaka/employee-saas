import { z } from "zod";
import { RoleSchema } from "./roles.js";

export const LoginRequestSchema = z.object({
  companyCode: z.string().trim().min(1),
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const PlatformLoginRequestSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});
export type PlatformLoginRequest = z.infer<typeof PlatformLoginRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string(),
  companyId: z.string().nullable(),
  employeeId: z.string().nullable(),
  email: z.string().nullable(),
  role: RoleSchema,
  mustChangePassword: z.boolean(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const LoginResponseSchema = z.object({
  user: AuthUserSchema,
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const RefreshResponseSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export const MeResponseSchema = z.object({
  user: AuthUserSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
