import type { User } from "@prisma/client";
import type { UserDto } from "@employee-saas/shared";

/** Never include passwordHash - this is the single place a User row is
 * turned into something an API response can include. */
export function toUserDto(user: User): UserDto {
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
