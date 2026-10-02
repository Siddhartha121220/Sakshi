// Proof bundle: docs/PROTOCOL.md §7. A self-contained file that lets anyone verify a photo
// without the Sakshi API.
import { z } from "zod";

const hex0x32 = z.string().regex(/^0x[0-9a-f]{64}$/, "expected 0x-prefixed 32-byte hex");
const hex0xAddress = z.string().regex(/^0x[0-9a-f]{40}$/, "expected 0x-prefixed 20-byte address");
const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, "expected base64");

export const AnchorInfoSchema = z.object({
  chainId: z.number().int().positive(),
  contract: hex0xAddress,
  batchId: z.number().int().nonnegative(),
  root: hex0x32,
  proof: z.array(hex0x32),
  txHash: z.string().regex(/^0x[0-9a-f]{64}$/),
});

export const ProofBundleSchema = z.object({
  format: z.literal("sakshi.proof"),
  version: z.literal(1),
  manifest: base64,
  signature: base64,
  device: z.object({
    publicKey: base64,
    securityLevel: z.enum(["strongbox", "tee"]),
    attestationChain: z.array(base64),
  }),
  anchor: AnchorInfoSchema.optional(), // omitted while the capture is pending
});

export type ProofBundle = z.infer<typeof ProofBundleSchema>;

export function parseProofBundle(json: unknown): ProofBundle {
  return ProofBundleSchema.parse(json);
}
