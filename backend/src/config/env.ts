import "dotenv/config";
import { z } from "zod";

const optionalTrimmedString = z.preprocess((value) => typeof value === "string" && !value.trim() ? undefined : value, z.string().trim().min(1).optional());
const optionalUrl = z.preprocess((value) => typeof value === "string" && !value.trim() ? undefined : value, z.string().url().optional());
const DIRECT_AUTH_CALLBACK_PATH = "/auth/callback";

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
  SESSION_COOKIE_DOMAIN: optionalTrimmedString,
  SESSION_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  AUTH_SESSION_DIAGNOSTICS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTH_HANDOFF_CIRCZLES_COM_SECRET: z.string().min(32).optional(),
  AUTH_HANDOFF_CIRCZLES_IN_SECRET: z.string().min(32).optional(),
  WIX_CLIENT_ID: optionalTrimmedString,
  WIX_DIRECT_AUTH_CALLBACK_URL: optionalUrl,
  WIX_APP_ID: z.string().optional(),
  WIX_APP_SECRET: z.string().optional(),
  WIX_CIRCZLES_IN_APP_ID: z.string().optional(),
  WIX_CIRCZLES_IN_APP_SECRET: z.string().optional(),
  WIX_WEBHOOK_PUBLIC_KEY: z.string().optional(),
  WIX_CIRCZLES_IN_WEBHOOK_PUBLIC_KEY: z.string().optional(),
  WIX_CIRCZLES_IN_INSTANCE_ID: z.string().optional(),
  WIX_CIRCZLES_COM_INSTANCE_ID: z.string().optional(),
  WIX_COGZART_IN_INSTANCE_ID: z.string().optional(),
  WIX_COGZART_COM_INSTANCE_ID: z.string().optional(),
  SHOPIFY_SHOP_DOMAIN: z.string().optional(),
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  MISSION_PROCESSOR_INTERVAL_MS: z.coerce.number().int().min(100).default(5000),
  MISSION_PROCESSOR_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(50),
}).superRefine((env, context) => {
  if (env.SESSION_COOKIE_SAME_SITE === "none" && !env.COOKIE_SECURE) {
    context.addIssue({ code: "custom", path: ["COOKIE_SECURE"], message: "COOKIE_SECURE must be true when SESSION_COOKIE_SAME_SITE is none." });
  }
  const frontendUrl = new URL(env.FRONTEND_ORIGIN);
  const hostedFrontend = frontendUrl.protocol === "https:"
    && frontendUrl.hostname !== "localhost"
    && frontendUrl.hostname !== "127.0.0.1"
    && frontendUrl.hostname !== "[::1]";
  if (env.NODE_ENV === "production" || hostedFrontend) {
    if (!env.COOKIE_SECURE) context.addIssue({ code: "custom", path: ["COOKIE_SECURE"], message: "Production session cookies must be Secure." });
    if (env.SESSION_COOKIE_SAME_SITE !== "lax") context.addIssue({ code: "custom", path: ["SESSION_COOKIE_SAME_SITE"], message: "Production Player Hub session cookies must use SameSite=Lax." });
    if (env.SESSION_COOKIE_DOMAIN) context.addIssue({ code: "custom", path: ["SESSION_COOKIE_DOMAIN"], message: "Production Player Hub session cookies must remain host-only." });
    const expectedCallbackUrl = new URL(DIRECT_AUTH_CALLBACK_PATH, frontendUrl.origin).toString();
    if (env.WIX_DIRECT_AUTH_CALLBACK_URL && env.WIX_DIRECT_AUTH_CALLBACK_URL !== expectedCallbackUrl) {
      context.addIssue({ code: "custom", path: ["WIX_DIRECT_AUTH_CALLBACK_URL"], message: "Production Wix callback must use the exact Player Hub frontend callback URL." });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(input = process.env): Env {
  return envSchema.parse(input);
}
