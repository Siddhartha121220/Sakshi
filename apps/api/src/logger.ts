import pino from "pino";
import type { Config } from "./config.js";

// CONTRIBUTING.md: never log manifests, signatures, or request bodies at info level — they can
// carry location data or other sensitive fields.
const REDACT_PATHS = ["req.body", "req.headers.x-sakshi-signature", "*.manifest", "*.signature"];

export function createLogger(config: Pick<Config, "LOG_LEVEL">) {
  // Plain JSON always — pipe through `npx pino-pretty` in dev if you want it formatted; not worth
  // an extra dependency just for that.
  return pino({
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  });
}

export type Logger = ReturnType<typeof createLogger>;
