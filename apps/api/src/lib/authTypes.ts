import type { Role } from "@employee-saas/shared";

export type RequestAuth = {
  userId: string;
  companyId: string | null;
  role: Role;
  employeeId: string | null;
  mustChangePassword: boolean;
};
