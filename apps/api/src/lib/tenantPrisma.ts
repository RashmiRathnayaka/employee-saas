import { platformPrisma } from "./prisma.js";

/**
 * Models that carry a companyId column and must always be filtered/stamped
 * by it. Company (the tenant root) and RefreshToken (scoped by userId, not
 * companyId) are deliberately excluded - see docs/architecture.md §5.
 */
const TENANT_MODELS = new Set([
  "CompanySettings",
  "Department",
  "Designation",
  "Employee",
  "User",
  "LeaveType",
  "CompanyHoliday",
  "LeaveBalance",
  "LeaveRequest",
  "LeaveApproval",
  "LeaveRequestDocument",
  "Notification",
  "AuditLog",
]);

const WHERE_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

/**
 * Returns a Prisma client scoped to one company: every read/write on a
 * tenant-owned table is automatically filtered (or stamped, on create) with
 * this companyId - callers cannot override it, even if they try to set a
 * different companyId in the input. companyId must come from the verified
 * access token (req.auth.companyId), never from request body/query/headers.
 */
export function getTenantPrisma(companyId: string) {
  return platformPrisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) {
            return query(args);
          }

          const scopedArgs = args as Record<string, unknown>;

          if (WHERE_OPERATIONS.has(operation)) {
            scopedArgs.where = { ...(scopedArgs.where as object | undefined), companyId };
          }

          if (operation === "create") {
            scopedArgs.data = { ...(scopedArgs.data as object | undefined), companyId };
          }

          if (operation === "createMany") {
            const data = scopedArgs.data;
            scopedArgs.data = Array.isArray(data)
              ? data.map((row) => ({ ...row, companyId }))
              : { ...(data as object | undefined), companyId };
          }

          if (operation === "upsert") {
            scopedArgs.create = { ...(scopedArgs.create as object | undefined), companyId };
            scopedArgs.update = { ...(scopedArgs.update as object | undefined), companyId };
          }

          return query(scopedArgs);
        },
      },
    },
  });
}

export type TenantPrisma = ReturnType<typeof getTenantPrisma>;
