import { z } from "zod";

export const ROLES = [
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "HR",
  "MANAGER",
  "EMPLOYEE",
] as const;

export const RoleSchema = z.enum(ROLES);

export type Role = z.infer<typeof RoleSchema>;
