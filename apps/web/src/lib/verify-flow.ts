// Orchestrates docs/PROTOCOL.md §8 (exact path) and §8.1 (perceptual fallback). Deliberately
// separate from the UI and from image decoding: everything here takes already-computed hashes and
// bytes, so it's testable in plain Node (see apps/web/test/verify-flow.test.ts) against a real
// local chain and API, without a browser.
import { verifyBundle, type ChainReader, type Manifest, type ProofBundle, type VerifyResult } from "@sakshi/core";
import { fetchCaptureByHash, searchSimilar, fetchCaptureById, type CaptureSummary } from "./api-client.js";
import type { HashResult } from "./hash-types.js";

export type AppVerdict =
  | VerifyResult
  | { verdict: "SIMILAR_TO_AUTHENTIC"; distance: number; manifest: Manifest; capture: CaptureSummary }
  | { verdict: "NO_PROVENANCE" }
  | { verdict: "LOOKUP_FAILED"; message: string };

export interface VerifyFlowResult {
  verdict: AppVerdict;
  /** The bundle the verdict was based on, if any — e.g. for showing an explorer link. */
  bundle: ProofBundle | null;
}

export interface VerifyFlowDeps {
  chainReader: ChainReader;
  apiBaseUrl?: string;
}

/**
 * `providedBundle` is set when the user uploaded a `.sakshi.json` proof bundle file directly
 * (docs/API.md FR-W4) — skips the API lookup entirely, per PROTOCOL §8 step 2.
 */
export async function verifyUploadedFile(
  fileBytes: Uint8Array,
  hash: HashResult,
  deps: VerifyFlowDeps,
  providedBundle?: ProofBundle,
): Promise<VerifyFlowResult> {
  let bundle: ProofBundle | null | undefined = providedBundle;
  if (!bundle) {
    try {
      const capture = await fetchCaptureByHash(hash.sha256Hex, deps.apiBaseUrl);
      bundle = capture?.bundle ?? null;
    } catch (err) {
      return { verdict: { verdict: "LOOKUP_FAILED", message: err instanceof Error ? err.message : String(err) }, bundle: null };
    }
  }

  if (bundle) {
    return { verdict: await verifyBundle(fileBytes, bundle, deps.chainReader), bundle };
  }

  // No exact match — fall back to perceptual search (§8.1), if the image was hashable at all.
  if (!hash.phashHex) {
    return { verdict: { verdict: "NO_PROVENANCE" }, bundle: null };
  }

  let candidates;
  try {
    candidates = await searchSimilar(hash.phashHex, deps.apiBaseUrl);
  } catch (err) {
    return { verdict: { verdict: "LOOKUP_FAILED", message: err instanceof Error ? err.message : String(err) }, bundle: null };
  }

  for (const candidate of candidates) {
    const capture = await fetchCaptureById(candidate.captureId, deps.apiBaseUrl).catch(() => null);
    if (!capture) continue;
    // §8.1 step 3: verify the CANDIDATE's own bundle (fileBytes: null skips the hash-match check —
    // we're confirming this similar photo is itself authentic, not that it's the uploaded file).
    const result = await verifyBundle(null, capture.bundle, deps.chainReader);
    if (result.verdict === "AUTHENTIC") {
      return { verdict: { verdict: "SIMILAR_TO_AUTHENTIC", distance: candidate.distance, manifest: result.manifest, capture }, bundle: capture.bundle };
    }
  }

  return { verdict: { verdict: "NO_PROVENANCE" }, bundle: null };
}
