// GET /v1/time-beacon: docs/API.md. A recent block the Android app embeds in each manifest so a
// verifier can later prove a lower time bound (docs/PROTOCOL.md §6). Cached briefly since every
// phone polls this every 30s while the camera is open.
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";

const CACHE_TTL_MS = 10_000;

export function registerTimeBeaconRoute(app: FastifyInstance, ctx: AppContext) {
  let cache: { fetchedAt: number; body: unknown } | null = null;

  app.get("/v1/time-beacon", async () => {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.body;

    const block = await ctx.publicClient.getBlock();
    const body = {
      chainId: ctx.config.CHAIN_ID,
      blockNumber: Number(block.number),
      blockHash: block.hash,
      timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
    };
    cache = { fetchedAt: Date.now(), body };
    return body;
  });
}
