// docs/API.md "Captures". The core submit/verify loop: docs/ARCHITECTURE.md §3.2.
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { fromBase64, fromHex, parseManifestBytes, phashFromHex, sha256, toBase64, toHex0x, verifyP256Signature } from "@sakshi/core";
import type { AppContext } from "../app.js";
import { requireDeviceSignature } from "../app.js";
import { toSignedBigInt64 } from "../lib/bigint64.js";
import type { Sql } from "../db.js";
import type { CaptureRow, AnchorBatchRow, BatchStatus } from "../types.js";

const SubmitBodySchema = z.object({
  manifest: z.string().min(1),
  signature: z.string().min(1),
});

type CaptureWithContext = CaptureRow & {
  devicePublicKey: Buffer;
  deviceSecurityLevel: "strongbox" | "tee";
  deviceAttestationChain: Buffer[];
  batchStatus: BatchStatus | null;
  batchOnchainBatchId: string | null;
  batchChainId: number | null;
  batchContractAddress: Buffer | null;
  batchTxHash: Buffer | null;
};

/** `where` is a `sql\`...\`` fragment (postgres.js composes nested fragments natively). */
function captureWithContext(sql: Sql, where: ReturnType<Sql>) {
  return sql<CaptureWithContext[]>`
    select
      c.*,
      d.public_key as device_public_key,
      d.security_level as device_security_level,
      d.attestation_chain as device_attestation_chain,
      b.status as batch_status,
      b.onchain_batch_id as batch_onchain_batch_id,
      b.chain_id as batch_chain_id,
      b.contract_address as batch_contract_address,
      b.tx_hash as batch_tx_hash
    from captures c
    join devices d on d.id = c.device_id
    left join anchor_batches b on b.id = c.batch_id
    ${where}
  `;
}

export function registerCaptureRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/v1/captures", { preHandler: requireDeviceSignature(ctx) }, async (request, reply) => {
    const parsedBody = SubmitBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ error: { code: "INVALID_BODY", message: parsedBody.error.message } });
    }
    const device = request.device!; // set by requireDeviceSignature

    let manifestBytes: Uint8Array;
    let signatureDer: Uint8Array;
    try {
      manifestBytes = fromBase64(parsedBody.data.manifest);
      signatureDer = fromBase64(parsedBody.data.signature);
    } catch {
      return reply.status(400).send({ error: { code: "INVALID_MANIFEST", message: "manifest/signature must be valid base64" } });
    }

    const parsedManifest = parseManifestBytes(manifestBytes);
    if (!parsedManifest.ok) {
      return reply.status(400).send({ error: { code: "INVALID_MANIFEST", message: parsedManifest.error } });
    }
    const manifest = parsedManifest.manifest;

    if (manifest.deviceId !== device.id) {
      return reply.status(400).send({ error: { code: "INVALID_MANIFEST", message: "manifest.deviceId does not match the authenticated device" } });
    }
    if (device.compromisedAt) {
      return reply.status(403).send({ error: { code: "DEVICE_REVOKED", message: "this device's key has been revoked" } });
    }

    const signatureValid = await verifyP256Signature(device.publicKey, manifestBytes, signatureDer);
    if (!signatureValid) {
      return reply.status(401).send({ error: { code: "BAD_SIGNATURE", message: "manifest signature does not verify against the device key" } });
    }

    if (manifest.beacon) {
      const block = await ctx.publicClient.getBlock({ blockNumber: BigInt(manifest.beacon.blockNumber) }).catch(() => null);
      if (!block || block.hash?.toLowerCase() !== manifest.beacon.blockHash.toLowerCase()) {
        return reply.status(400).send({ error: { code: "INVALID_MANIFEST", message: "beacon block does not exist or hash does not match the chain" } });
      }
    }

    const sha256Bytes = Buffer.from(fromHex(manifest.sha256));
    const [existing] = await ctx.sql<{ id: string; deviceId: string }[]>`
      select id, device_id as "deviceId" from captures where sha256 = ${sha256Bytes}
    `;
    if (existing) {
      if (existing.deviceId !== device.id) {
        return reply.status(409).send({ error: { code: "DUPLICATE_IMAGE", message: "this image was already submitted by a different device" } });
      }
      return reply.status(200).send({ captureId: existing.id, status: "pending" });
    }

    const manifestDigest = await sha256(manifestBytes);
    const phashSigned = toSignedBigInt64(phashFromHex(manifest.phash));
    const tileHashes = Buffer.concat(manifest.tiles.map((t) => fromHex(t)));

    const [capture] = await ctx.sql<CaptureRow[]>`
      insert into captures (
        device_id, sha256, manifest_bytes, manifest_digest, signature,
        phash, tile_hashes, width, height, captured_at_claimed,
        beacon_chain_id, beacon_block_number, beacon_block_hash
      ) values (
        ${device.id}, ${sha256Bytes}, ${Buffer.from(manifestBytes)}, ${Buffer.from(manifestDigest)}, ${Buffer.from(signatureDer)},
        ${phashSigned.toString()}, ${tileHashes}, ${manifest.width}, ${manifest.height}, ${manifest.capturedAt},
        ${manifest.beacon?.chainId ?? null}, ${manifest.beacon?.blockNumber ?? null},
        ${manifest.beacon ? Buffer.from(fromHex(manifest.beacon.blockHash)) : null}
      )
      returning *
    `;

    return reply.status(202).send({ captureId: capture!.id, status: "pending" });
  });

  app.get<{ Params: { id: string } }>("/v1/captures/:id", async (request, reply) => {
    const [row] = await captureWithContext(ctx.sql, ctx.sql`where c.id = ${request.params.id}`);
    return sendCaptureResponse(reply, row, ctx);
  });

  app.get<{ Params: { sha256: string } }>("/v1/captures/by-hash/:sha256", async (request, reply) => {
    let hashBytes: Buffer;
    try {
      hashBytes = Buffer.from(fromHex(request.params.sha256));
    } catch {
      return reply.status(400).send({ error: { code: "INVALID_HASH", message: "sha256 must be 64 hex chars" } });
    }
    const [row] = await captureWithContext(ctx.sql, ctx.sql`where c.sha256 = ${hashBytes}`);
    return sendCaptureResponse(reply, row, ctx);
  });

  app.get<{ Params: { id: string } }>("/v1/captures/:id/status", async (request, reply) => {
    const [row] = await ctx.sql<{ status: BatchStatus | null; txHash: Buffer | null; anchoredAt: Date | null }[]>`
      select b.status, b.tx_hash as "txHash", b.finalized_at as "anchoredAt"
      from captures c left join anchor_batches b on b.id = c.batch_id
      where c.id = ${request.params.id}
    `;
    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "capture not found" } });
    return {
      status: row.status ?? "pending",
      txHash: row.txHash ? toHex0x(row.txHash) : null,
      anchoredAt: row.anchoredAt?.toISOString() ?? null,
    };
  });

  app.post("/v1/captures/search-similar", async (request, reply) => {
    const parsed = z.object({ phash: z.string().regex(/^[0-9a-f]{16}$/) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_BODY", message: parsed.error.message } });
    }
    const target = toSignedBigInt64(phashFromHex(parsed.data.phash)).toString();
    const candidates = await ctx.sql<{ captureId: string; distance: number }[]>`
      select id as "captureId", bit_count((phash # ${target}::bigint)::bit(64))::int as distance
      from captures
      where bit_count((phash # ${target}::bigint)::bit(64)) <= 14
      order by distance
      limit 10
    `;
    return { candidates };
  });
}

async function sendCaptureResponse(reply: FastifyReply, row: CaptureWithContext | undefined, ctx: AppContext) {
  if (!row) {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "capture not found" } });
  }

  const status = row.batchStatus ?? "pending";
  const bundle: Record<string, unknown> = {
    format: "sakshi.proof",
    version: 1,
    manifest: toBase64(row.manifestBytes),
    signature: toBase64(row.signature),
    device: {
      publicKey: toBase64(row.devicePublicKey),
      securityLevel: row.deviceSecurityLevel,
      attestationChain: row.deviceAttestationChain.map((c) => toBase64(c)),
    },
  };

  if (row.batchOnchainBatchId !== null && row.batchContractAddress && row.batchTxHash && row.merkleProof) {
    bundle.anchor = {
      chainId: row.batchChainId,
      contract: toHex0x(row.batchContractAddress),
      batchId: Number(row.batchOnchainBatchId),
      root: await lookupRoot(ctx, row.batchId!),
      proof: row.merkleProof.map((p) => toHex0x(p)),
      txHash: toHex0x(row.batchTxHash),
    };
  }

  return reply.send({
    captureId: row.id,
    status,
    securityLevel: row.deviceSecurityLevel,
    originalUrl: null, // publishing lands in Phase 6
    bundle,
  });
}

async function lookupRoot(ctx: AppContext, batchId: string): Promise<string> {
  const [batch] = await ctx.sql<Pick<AnchorBatchRow, "merkleRoot">[]>`select merkle_root as "merkleRoot" from anchor_batches where id = ${batchId}`;
  return toHex0x(batch!.merkleRoot);
}
