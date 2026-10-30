import type { User } from "@prisma/client";
import type { UserDto } from "@employee-saas/shared";

/** Never include passwordHash - this is the single place a User row is
 * turned into something an API response can include. Accepts User with or
 * without passwordHash present (most reads have it globally omitted - see
 * lib/prisma.ts - but the function itself never reads that field either way). */
export function toUserDto(user: Omit<User, "passwordHash">): UserDto {
  return {
    id: user.id,
    companyId: user.companyId,
    employeeId: user.employeeId,
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
  };
}
