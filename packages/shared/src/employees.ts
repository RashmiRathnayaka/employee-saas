import { z } from "zod";
import { UserSchema } from "./users.js";

export const EmployeeLoginRoleSchema = z.enum(["EMPLOYEE", "MANAGER", "HR"]);
export const EmployeeStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export const CreateEmployeeRequestSchema = z
  .object({
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    phone: z.string().trim().min(1).optional(),
    departmentId: z.string().optional(),
    designationId: z.string().optional(),
    managerId: z.string().optional(),
    joiningDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "joiningDate must be YYYY-MM-DD"),
    createLogin: z.boolean().default(false),
    loginEmail: z.string().trim().email().optional(),
    loginRole: EmployeeLoginRoleSchema.default("EMPLOYEE"),
  })
  .refine((data) => !data.createLogin || !!data.loginEmail, {
    message: "loginEmail is required when createLogin is true",
    path: ["loginEmail"],
  });
export type CreateEmployeeRequest = z.infer<typeof CreateEmployeeRequestSchema>;

export const UpdateEmployeeRequestSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  phone: z.string().trim().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  designationId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
});
export type UpdateEmployeeRequest = z.infer<typeof UpdateEmployeeRequestSchema>;

export const UpdateEmployeeStatusRequestSchema = z.object({
  status: EmployeeStatusSchema,
});
export type UpdateEmployeeStatusRequest = z.infer<typeof UpdateEmployeeStatusRequestSchema>;

export const UpdateOwnProfileRequestSchema = z.object({
  phone: z.string().trim().nullable().optional(),
});
export type UpdateOwnProfileRequest = z.infer<typeof UpdateOwnProfileRequestSchema>;

export const EmployeeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  departmentId: z.string().optional(),
  status: EmployeeStatusSchema.optional(),
});
export type EmployeeListQuery = z.infer<typeof EmployeeListQuerySchema>;

export const EmployeeSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  employeeCode: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  photoUrl: z.string().nullable(),
  departmentId: z.string().nullable(),
  designationId: z.string().nullable(),
  managerId: z.string().nullable(),
  joiningDate: z.string(),
  status: EmployeeStatusSchema,
  // The login account linked to this employee, if one exists - lets the UI
  // call /users/:id/reset-password (keyed by user id, not employee id).
  userId: z.string().nullable(),
  // Resolved display names, nested alongside the *Id fields above (which
  // stay as-is for anything that still just needs the id, e.g. form
  // defaults). Added for the mobile app's Profile/Home screens: an
  // EMPLOYEE's own role can't call GET /employees/:id for their manager
  // (that's self/team/admin-only), so without this the mobile app would
  // have no way to show a manager's name at all.
  department: z.object({ id: z.string(), name: z.string() }).nullable(),
  designation: z.object({ id: z.string(), name: z.string() }).nullable(),
  manager: z
    .object({ id: z.string(), employeeCode: z.string(), firstName: z.string(), lastName: z.string() })
    .nullable(),
});
export type EmployeeDto = z.infer<typeof EmployeeSchema>;

export const CreateEmployeeResponseSchema = z.object({
  employee: EmployeeSchema,
  login: z.object({ user: UserSchema, temporaryPassword: z.string() }).nullable(),
});
export type CreateEmployeeResponse = z.infer<typeof CreateEmployeeResponseSchema>;
