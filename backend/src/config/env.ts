import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WIX_CLIENT_ID: z.string().optional(),
  WIX_API_KEY: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  MISSION_PROCESSOR_INTERVAL_MS: z.coerce.number().int().min(100).default(5000),
  MISSION_PROCESSOR_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(50),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(input = process.env): Env {
  return envSchema.parse(input);
}
