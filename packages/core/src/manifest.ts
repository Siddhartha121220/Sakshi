// Capture manifest: docs/PROTOCOL.md §3. The zod schema is the executable form of §3.1's field
// table — validate every manifest through this before trusting any field.
import { z } from "zod";
import { jcsEncode, isCanonicalJcs } from "./jcs.js";

const hex = (len: number) => z.string().regex(new RegExp(`^[0-9a-f]{${len}}$`), `expected ${len} lowercase hex chars`);
const hex0x32 = z.string().regex(/^0x[0-9a-f]{64}$/, "expected 0x-prefixed 32-byte hex");
// Exactly 3 decimal places, as a string (no floats in manifests — docs/PROTOCOL.md §3.1).
const decimal3 = z.string().regex(/^-?\d+\.\d{3}$/, "expected a decimal string with exactly 3 places");

export const BeaconSchema = z.object({
  chainId: z.number().int().positive(),
  blockNumber: z.number().int().nonnegative(),
  blockHash: hex0x32,
});

export const LocationSchema = z.object({
  lat: decimal3,
  lng: decimal3,
});

export const ManifestSchema = z.object({
  v: z.literal(1),
  type: z.literal("sakshi.capture"),
  deviceId: z.string().uuid(),
  sha256: hex(64),
  mime: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  phash: hex(16),
  tiles: z.array(hex(16)).length(16),
  capturedAt: z.string().datetime(),
  beacon: BeaconSchema.optional(),
  location: LocationSchema.optional(),
  app: z.object({
    version: z.string().min(1),
    build: z.number().int().positive(),
  }),
});

export type Manifest = z.infer<typeof ManifestSchema>;

/** Canonicalises and validates a manifest object, returning the signed bytes (docs/PROTOCOL.md §3.2). */
export function buildManifestBytes(manifest: Manifest): Uint8Array {
  const validated = ManifestSchema.parse(manifest);
  return jcsEncode(validated);
}

export type ParsedManifestResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; error: "NOT_CANONICAL" | "SCHEMA_INVALID"; detail?: unknown };

/**
 * Parses signed manifest bytes, enforcing docs/PROTOCOL.md §8 step 3: the bytes must already be
 * the canonical JCS encoding of their own content, and must match the schema.
 */
export function parseManifestBytes(bytes: Uint8Array): ParsedManifestResult {
  if (!isCanonicalJcs(bytes)) {
    return { ok: false, error: "NOT_CANONICAL" };
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return { ok: false, error: "SCHEMA_INVALID", detail: e };
  }
  const result = ManifestSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: "SCHEMA_INVALID", detail: result.error };
  }
  return { ok: true, manifest: result.data };
}
