import type { Request } from "express";
import { ApiError } from "./errors.js";

/** For the "self" endpoints: a Company Admin account may have no employee profile. */
export function ownEmployee(req: Request) {
  if (!req.auth!.employeeId) {
    throw new ApiError(403, "NO_EMPLOYEE_PROFILE", "This action needs an employee profile.");
  }
  return { companyId: req.auth!.companyId!, employeeId: req.auth!.employeeId };
}
