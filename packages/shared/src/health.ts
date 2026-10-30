import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  db: z.literal("ok"),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
