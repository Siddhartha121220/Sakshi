// All runtime configuration in one validated place. Fails fast and loudly on a bad/missing env var
// rather than letting it surface later as a confusing runtime error.
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "silent"]).default("info"),

  // Chain
  CHAIN_ID: z.coerce.number().int().positive(),
  RPC_URL: z.string().url(),
  SAKSHI_ANCHOR_CONTRACT: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  ANCHORER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(), // only needed by the worker

  // Anchor worker tuning
  ANCHOR_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  ANCHOR_MAX_BATCH_SIZE: z.coerce.number().int().positive().default(10_000),
  ANCHOR_STUCK_TX_TIMEOUT_MS: z.coerce.number().int().positive().default(3 * 60 * 1000),
  // Used only when the chain doesn't support the 'finalized' block tag (e.g. local Anvil) —
  // see worker.ts pollFinality().
  FINALITY_FALLBACK_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(1),

  // Device registration
  SERVER_CHALLENGE_SECRET: z.string().min(16),
  CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  ALLOWED_APP_PACKAGE: z.string().default("app.sakshi"),
  // Comma-separated hex sha256 digests of the app's signing cert(s) (PROTOCOL §2.3 A7).
  ALLOWED_APP_CERT_DIGESTS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)),

  // Dev-only: skip real Key Attestation verification so a software "fake device" can register.
  // MUST be refused in production — enforced below, not just by this flag's default.
  DEV_SKIP_ATTESTATION: z
    .string()
    .default("false")
    .transform((s) => s === "true"),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === "production" && config.DEV_SKIP_ATTESTATION) {
    throw new Error("DEV_SKIP_ATTESTATION must not be set in production (see CONTRIBUTING.md security section)");
  }
  return config;
}
