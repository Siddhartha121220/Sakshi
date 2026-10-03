import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import type { Config } from "./config.js";
import type { Sql } from "./db.js";
import type { Logger } from "./logger.js";
import type { ChainReader } from "@sakshi/core";
import type { createViemPublicClient } from "./chain.js";
import { isTimestampFresh, parseDeviceAuthHeaders, verifyDeviceSignedRequest } from "./lib/device-auth.js";
import type { DeviceRow } from "./types.js";

import { registerDeviceRoutes } from "./routes/devices.js";
import { registerCaptureRoutes } from "./routes/captures.js";
import { registerTimeBeaconRoute } from "./routes/time-beacon.js";
import { registerBatchRoutes } from "./routes/batches.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerVerificationEventRoutes } from "./routes/verification-events.js";

export interface AppContext {
  config: Config;
  sql: Sql;
  logger: Logger;
  chainReader: ChainReader;
  publicClient: ReturnType<typeof createViemPublicClient>;
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function buildApp(ctx: AppContext): FastifyInstance {
  // Fastify's own request logging is skipped (routes and the error handler log through ctx.logger
  // directly); passing a raw pino instance as loggerInstance fights exactOptionalPropertyTypes and
  // poisons every route's generics, which isn't worth it for logging we don't otherwise need.
  const app = Fastify();

  // The web verifier (apps/web) is a static site running on its own origin and calls these routes
  // directly from the browser — invariant #6 (it trusts the chain, not the API), but it still needs
  // CORS to fetch bundles/report events. Everything here is public, read-mostly data anyway.
  void app.register(cors, { origin: true });

  // Capture the exact raw request bytes (needed for docs/PROTOCOL.md §9's body-hash check) while
  // still handing Fastify a parsed object, via a custom content-type parser. Also covers
  // text/plain: the Android client's Retrofit scalars converter sends JSON bodies under that
  // content type (it only serializes/deserializes Strings), and the raw bytes are JSON either way.
  app.addContentTypeParser(["application/json", "text/plain"], { parseAs: "buffer" }, (req, body, done) => {
    req.rawBody = body as Buffer;
    if (body.length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse(body.toString("utf8")));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.setErrorHandler((err: Error & { validation?: unknown }, _req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err.validation) {
      return reply.status(400).send({ error: { code: "INVALID_BODY", message: err.message } });
    }
    ctx.logger.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "INTERNAL", message: "internal server error" } });
  });

  registerHealthRoute(app, ctx);
  registerDeviceRoutes(app, ctx);
  registerTimeBeaconRoute(app, ctx);
  registerCaptureRoutes(app, ctx);
  registerBatchRoutes(app, ctx);
  registerVerificationEventRoutes(app, ctx);

  return app;
}

/**
 * Fastify preHandler: verifies the X-Sakshi-* signed-request headers (docs/PROTOCOL.md §9) and, on
 * success, attaches the authenticated device row as `request.device`.
 */
export function requireDeviceSignature(ctx: Pick<AppContext, "sql">) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseDeviceAuthHeaders(request.headers as Record<string, string | string[] | undefined>);
    if (!parsed) {
      return reply.status(401).send({ error: { code: "MISSING_AUTH_HEADERS", message: "missing or malformed X-Sakshi-* headers" } });
    }
    if (!isTimestampFresh(parsed.timestamp)) {
      return reply.status(401).send({ error: { code: "STALE_TIMESTAMP", message: "request timestamp outside the allowed clock skew" } });
    }

    const rows = await ctx.sql<DeviceRow[]>`select * from devices where id = ${parsed.deviceId}`;
    const device = rows[0];
    if (!device) {
      return reply.status(401).send({ error: { code: "UNKNOWN_DEVICE", message: "device not registered" } });
    }

    const bodyBytes = request.rawBody ?? Buffer.alloc(0);
    // request.url includes the query string; fine today since every device-signed route is
    // query-string-free, but a future one with query params needs the path split out first.
    const valid = await verifyDeviceSignedRequest({
      method: request.method,
      path: request.url,
      timestamp: parsed.timestamp,
      bodyBytes,
      signatureDer: parsed.signatureDer,
      devicePublicKeySpki: device.publicKey,
    });
    if (!valid) {
      return reply.status(401).send({ error: { code: "BAD_SIGNATURE", message: "request signature does not verify" } });
    }

    request.device = device;
  };
}
