import { z } from "zod";
import { RoleSchema } from "./roles.js";

// A standalone user account (no employee profile) can only be given one of
// these roles - EMPLOYEE accounts are created through the employee module
// instead, and SUPER_ADMIN is platform-only (no self-serve endpoint).
export const AssignableCompanyRoleSchema = z.enum(["COMPANY_ADMIN", "HR", "MANAGER"]);

export const CreateUserRequestSchema = z.object({
  email: z.string().trim().email(),
  role: AssignableCompanyRoleSchema,
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRoleRequestSchema = z.object({
  role: AssignableCompanyRoleSchema,
});
export type UpdateUserRoleRequest = z.infer<typeof UpdateUserRoleRequestSchema>;

export const UpdateUserStatusRequestSchema = z.object({
  status: z.enum(["ACTIVE", "DEACTIVATED"]),
});
export type UpdateUserStatusRequest = z.infer<typeof UpdateUserStatusRequestSchema>;

export const UserSchema = z.object({
  id: z.string(),
  companyId: z.string().nullable(),
  employeeId: z.string().nullable(),
  email: z.string().nullable(),
  role: RoleSchema,
  status: z.enum(["ACTIVE", "DEACTIVATED"]),
  mustChangePassword: z.boolean(),
});
export type UserDto = z.infer<typeof UserSchema>;

export const CreateUserResponseSchema = z.object({
  user: UserSchema,
  temporaryPassword: z.string(),
});
export type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;
