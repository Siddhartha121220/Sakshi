import type { FastifyInstance } from "fastify";
import { toHex0x } from "@sakshi/core";
import type { AppContext } from "../app.js";
import type { AnchorBatchRow } from "../types.js";

export function registerBatchRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Params: { id: string } }>("/v1/batches/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      return reply.status(400).send({ error: { code: "INVALID_ID", message: "batch id must be an integer" } });
    }
    const [batch] = await ctx.sql<AnchorBatchRow[]>`select * from anchor_batches where id = ${id}`;
    if (!batch) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "batch not found" } });
    }
    return {
      id: batch.id,
      chainId: batch.chainId,
      contract: toHex0x(batch.contractAddress),
      onchainBatchId: batch.onchainBatchId,
      root: toHex0x(batch.merkleRoot),
      leafCount: batch.leafCount,
      txHash: batch.txHash ? toHex0x(batch.txHash) : null,
      blockNumber: batch.blockNumber,
      blockTimestamp: batch.blockTimestamp?.toISOString() ?? null,
      status: batch.status,
    };
  });
}
