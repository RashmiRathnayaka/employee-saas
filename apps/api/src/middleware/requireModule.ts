import type { NextFunction, Request, Response } from "express";
import type { CompanyModule } from "@employee-saas/shared";
import { isCompanyModuleEnabled } from "../lib/enabledModules.js";
import { ApiError } from "../lib/errors.js";

/**
 * Blocks a whole router when the caller's company has that module switched
 * off. Goes right after requireAuth, so it runs before any resource lookup:
 * a disabled module answers 403 even for another company's id, which leaks
 * nothing because the answer is only about the caller's own company.
 *
 * The company always comes from the session (req.auth), never the request.
 */
export function requireModule(module: CompanyModule) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(new ApiError(401, "UNAUTHENTICATED", "Authentication required."));
      return;
    }
    if (!req.auth.companyId) {
      next(new ApiError(403, "FORBIDDEN", "This action requires a company account."));
      return;
    }

    try {
      if (await isCompanyModuleEnabled(req.auth.companyId, module)) {
        next();
        return;
      }
      next(new ApiError(403, "MODULE_DISABLED", `The ${module} module is not enabled for this company.`, { module }));
    } catch (err) {
      // Express 4 doesn't catch a rejected async middleware. Passing it on
      // gives a 500, which fails closed: the request doesn't get through.
      next(err);
    }
  };
}
