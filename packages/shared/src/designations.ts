import { z } from "zod";

export const CreateDesignationRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateDesignationRequest = z.infer<typeof CreateDesignationRequestSchema>;

export const UpdateDesignationRequestSchema = CreateDesignationRequestSchema;
export type UpdateDesignationRequest = z.infer<typeof UpdateDesignationRequestSchema>;

export const DesignationSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type DesignationDto = z.infer<typeof DesignationSchema>;
