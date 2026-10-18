// Verification links: the phone's "Share proof" sends `<verifier>/?hash=<sha256>`. The link carries only
// the photo's hash — never the photo — so on its own it proves nothing: opening it preloads that
// capture's proof, and the recipient still drops the photo, which must hash to the same value and pass
// every check against the chain (docs/PROTOCOL.md §8). The API is trusted only to deliver the bundle.
import { fromBase64, parseManifestBytes, parseProofBundle, type ProofBundle } from "@sakshi/core";
import { fetchCaptureByHash, type CaptureSummary } from "./api-client.js";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The capture hash named by a verification link's query string, or null if absent or malformed. */
export function parseProofLinkHash(search: string): string | null {
  const raw = new URLSearchParams(search).get("hash")?.trim().toLowerCase();
  return raw && SHA256_HEX.test(raw) ? raw : null;
}

export type LinkedProof =
  | { kind: "found"; bundle: ProofBundle; capturedAt: string | null }
  | { kind: "not_found" };

export async function loadLinkedProof(
  sha256Hex: string,
  fetchByHash: (hash: string) => Promise<CaptureSummary | null> = fetchCaptureByHash,
): Promise<LinkedProof> {
  const capture = await fetchByHash(sha256Hex);
  if (!capture) return { kind: "not_found" };
  const bundle = parseProofBundle(capture.bundle);
  const parsed = parseManifestBytes(fromBase64(bundle.manifest));
  return { kind: "found", bundle, capturedAt: parsed.ok ? parsed.manifest.capturedAt : null };
}
