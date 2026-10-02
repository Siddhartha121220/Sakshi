// docs/API.md "Metrics". Anonymous outcome counts for the pilot's success metrics
// (docs/PRD.md §8) — deliberately no IP or user agent (docs/DATABASE.md §5).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";

const BodySchema = z.object({
  captureId: z.string().uuid().nullable(),
  method: z.enum(["exact", "perceptual", "bundle_file"]),
  verdict: z.enum(["authentic", "authentic_pending", "similar_to_authentic", "device_revoked", "invalid", "no_provenance"]),
  hammingDistance: z.number().int().min(0).max(64).nullable(),
});

export function registerVerificationEventRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/v1/verification-events", async (request, reply) => {
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_BODY", message: parsed.error.message } });
    }
    const { captureId, method, verdict, hammingDistance } = parsed.data;

    // A bad/unknown captureId shouldn't break metrics collection — the column is nullable and
    // ON DELETE SET NULL for exactly this reason (docs/DATABASE.md).
    const validCaptureId = captureId && (await ctx.sql`select 1 from captures where id = ${captureId}`).length > 0 ? captureId : null;

    await ctx.sql`
      insert into verification_events (capture_id, method, verdict, hamming_distance)
      values (${validCaptureId}, ${method}, ${verdict}, ${hammingDistance})
    `;
    return reply.status(204).send();
  });
}
