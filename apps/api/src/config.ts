import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  FILE_TOKEN_SECRET: z.string().min(32, "FILE_TOKEN_SECRET must be at least 32 characters"),
  STORAGE_LOCAL_PATH: z.string().min(1).default("./storage-data"),

  // Only meaningful when STORAGE_DRIVER=s3 (still validated either way, so
  // switching drivers can't silently run with missing config).
  S3_ENDPOINT: z.string().url(),
  S3_PUBLIC_URL: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
});

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
