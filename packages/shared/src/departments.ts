import { z } from "zod";

export const CreateDepartmentRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateDepartmentRequest = z.infer<typeof CreateDepartmentRequestSchema>;

export const UpdateDepartmentRequestSchema = CreateDepartmentRequestSchema;
export type UpdateDepartmentRequest = z.infer<typeof UpdateDepartmentRequestSchema>;

export const DepartmentSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type DepartmentDto = z.infer<typeof DepartmentSchema>;
