import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/errors.js";

/** Blocks SUPER_ADMIN (and any other companyId-less account) from
 * "own company" routes - there's no "own company" for a platform account. */
export function requireCompanyContext(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth?.companyId) {
    next(new ApiError(403, "FORBIDDEN", "This action requires a company account."));
    return;
  }
  next();
}
