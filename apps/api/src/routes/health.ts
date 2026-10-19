import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";

export function registerHealthRoute(app: FastifyInstance, ctx: AppContext) {
  // People reach the bare API URL from the README or a post; answer with what this is rather than a 404.
  app.get("/", async () => ({
    service: "Sakshi API",
    about: "Capture-time photo provenance: hardware-signed photo fingerprints, Merkle-anchored on-chain.",
    chainId: ctx.config.CHAIN_ID,
    contract: ctx.config.SAKSHI_ANCHOR_CONTRACT,
    health: "/healthz",
    source: "https://github.com/Siddhartha121220/Sakshi",
  }));

  app.get("/healthz", async (_req, reply) => {
    let db = false;
    let rpc = false;
    let pendingCaptures = 0;
    let lastAnchorAt: string | null = null;

    try {
      await ctx.sql`select 1`;
      db = true;
      const countRows = await ctx.sql<{ count: string }[]>`select count(*)::int as count from captures where batch_id is null`;
      pendingCaptures = Number(countRows[0]?.count ?? 0);
      const [row] = await ctx.sql<{ lastAnchorAt: Date | null }[]>`select max(finalized_at) as "lastAnchorAt" from anchor_batches`;
      lastAnchorAt = row?.lastAnchorAt?.toISOString() ?? null;
    } catch {
      // db stays false
    }

    try {
      await ctx.publicClient.getBlockNumber();
      rpc = true;
    } catch {
      // rpc stays false
    }

    const ok = db && rpc;
    return reply.status(ok ? 200 : 503).send({ ok, db, rpc, pendingCaptures, lastAnchorAt });
  });
}
