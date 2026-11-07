import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  db: z.literal("ok"),
  timestamp: z.string(),
  worker: z.object({
    lastTickAt: z.string().nullable(),
    /** The last tick was under 2 minutes ago. */
    ok: z.boolean(),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
