import type { NextFunction, Request, Response } from "express";
import type { Role } from "@employee-saas/shared";
import { ApiError } from "../lib/errors.js";

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(new ApiError(401, "UNAUTHENTICATED", "Invalid or expired session."));
      return;
    }

    if (!roles.includes(req.auth.role)) {
      next(new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action."));
      return;
    }

    next();
  };
}
