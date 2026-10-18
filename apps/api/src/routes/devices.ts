// docs/API.md "Devices". Registration runs Android Key Attestation (docs/PROTOCOL.md §2).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { fromBase64, sha256 } from "@sakshi/core";
import { requireDeviceSignature, type AppContext } from "../app.js";
import { createChallenge } from "../lib/challenge.js";
import { verifyAndroidAttestation } from "../attestation.js";
import type { DeviceRow } from "../types.js";

const RegisterBodySchema = z.object({
  challenge: z.string().min(1),
  publicKey: z.string().min(1), // base64 SPKI DER
  attestationChain: z.array(z.string().min(1)), // base64 DER, leaf first
  appVersion: z.string().min(1),
});

export function registerDeviceRoutes(app: FastifyInstance, ctx: AppContext) {
  // Lets a device confirm the server still knows it BEFORE signing photos with that registration
  // (the app checks at startup). Signed like any device request, so it also proves key possession;
  // a forgotten device gets the same 401 UNKNOWN_DEVICE that requireDeviceSignature sends uploads.
  app.get("/v1/devices/me", { preHandler: requireDeviceSignature(ctx) }, async (request) => {
    const device = request.device!;
    return {
      deviceId: device.id,
      securityLevel: device.securityLevel,
      revoked: device.compromisedAt !== null,
    };
  });

  app.post("/v1/devices/challenge", async () => {
    const { challenge, expiresAt } = createChallenge(ctx.config.SERVER_CHALLENGE_SECRET);
    return { challenge, expiresAt: expiresAt.toISOString() };
  });

  app.post("/v1/devices", async (request, reply) => {
    const parsed = RegisterBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_BODY", message: parsed.error.message } });
    }
    const { challenge, publicKey, attestationChain, appVersion } = parsed.data;

    let publicKeySpki: Uint8Array;
    let attestationChainDer: Uint8Array[];
    try {
      publicKeySpki = fromBase64(publicKey);
      attestationChainDer = attestationChain.map(fromBase64);
    } catch {
      return reply.status(400).send({ error: { code: "INVALID_BODY", message: "publicKey/attestationChain must be valid base64" } });
    }

    const result = await verifyAndroidAttestation({
      publicKeySpki,
      attestationChainDer,
      challenge,
      serverChallengeSecret: ctx.config.SERVER_CHALLENGE_SECRET,
      challengeTtlSeconds: ctx.config.CHALLENGE_TTL_SECONDS,
      allowedPackage: ctx.config.ALLOWED_APP_PACKAGE,
      allowedCertDigests: ctx.config.ALLOWED_APP_CERT_DIGESTS,
      devSkipAttestation: ctx.config.DEV_SKIP_ATTESTATION,
    });

    if (!result.ok) {
      return reply.status(422).send({ error: { code: "ATTESTATION_FAILED", message: result.reason, reason: result.reason } });
    }

    const keyHash = await sha256(publicKeySpki);

    try {
      const [device] = await ctx.sql<DeviceRow[]>`
        insert into devices (public_key, key_hash, security_level, attestation_chain, attestation_info, app_version)
        values (
          ${Buffer.from(publicKeySpki)},
          ${Buffer.from(keyHash)},
          ${result.securityLevel},
          ${ctx.sql.array(attestationChainDer.map((c) => Buffer.from(c)))}::bytea[],
          ${ctx.sql.json({})},
          ${appVersion}
        )
        returning *
      `;
      return reply.status(201).send({ deviceId: device!.id, securityLevel: device!.securityLevel });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: { code: "DEVICE_EXISTS", message: "this device key is already registered" } });
      }
      throw err;
    }
  });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505";
}
