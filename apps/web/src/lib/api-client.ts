// Thin wrapper over docs/API.md's public read endpoints. The API is never trusted for a verdict
// (see chain-reader.ts) — it only delivers bundles and similarity candidates, which the caller then
// independently verifies against the chain.
import type { ProofBundle } from "@sakshi/core";
import { config } from "./config.js";

export interface CaptureSummary {
  captureId: string;
  status: string;
  securityLevel: "strongbox" | "tee";
  originalUrl: string | null;
  bundle: ProofBundle;
}

export interface SimilarCandidate {
  captureId: string;
  distance: number;
}

export async function fetchCaptureByHash(sha256Hex: string, apiBaseUrl: string = config.apiBaseUrl): Promise<CaptureSummary | null> {
  const res = await fetch(`${apiBaseUrl}/v1/captures/by-hash/${sha256Hex}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`capture lookup failed: HTTP ${res.status}`);
  return res.json() as Promise<CaptureSummary>;
}

export async function searchSimilar(phashHex: string, apiBaseUrl: string = config.apiBaseUrl): Promise<SimilarCandidate[]> {
  const res = await fetch(`${apiBaseUrl}/v1/captures/search-similar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phash: phashHex }),
  });
  if (!res.ok) throw new Error(`similarity search failed: HTTP ${res.status}`);
  const { candidates } = (await res.json()) as { candidates: SimilarCandidate[] };
  return candidates;
}

export async function fetchCaptureById(captureId: string, apiBaseUrl: string = config.apiBaseUrl): Promise<CaptureSummary | null> {
  const res = await fetch(`${apiBaseUrl}/v1/captures/${captureId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`capture lookup failed: HTTP ${res.status}`);
  return res.json() as Promise<CaptureSummary>;
}

/** Fire-and-forget metrics ping (docs/API.md POST /v1/verification-events) — failures are ignored. */
export function reportVerificationEvent(
  event: { captureId: string | null; method: "exact" | "perceptual" | "bundle_file"; verdict: string; hammingDistance?: number | undefined },
  apiBaseUrl: string = config.apiBaseUrl,
): void {
  fetch(`${apiBaseUrl}/v1/verification-events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hammingDistance: null, ...event }),
  }).catch(() => {});
}
