// Bundle verification: docs/PROTOCOL.md §8 (steps 1-13, excluding step 6 — in-browser attestation
// chain verification is tracked as P2 in docs/ROADMAP.md, so `securityLevel` is trusted from the
// bundle for now rather than independently re-derived). §8.1 (the perceptual-match fallback) is
// orchestration that needs a network call to the API's search-similar endpoint, so it lives in the
// web app (Phase 4), built on top of this function run once per candidate.
import { fromBase64, toHex0x } from "./bytes.js";
import { sha256 } from "./sha256.js";
import { verifyP256Signature } from "./signature.js";
import { parseManifestBytes, type Manifest } from "./manifest.js";
import { type ProofBundle } from "./bundle.js";
import { verifyCaptureInclusion } from "./merkle.js";
import type { ChainReader } from "./chain.js";

export interface ProvenTimeWindow {
  /** Lower bound: the beacon block's timestamp, if the manifest included one. */
  notBefore?: Date;
  /** Upper bound: when the batch containing this capture was anchored on-chain. */
  notAfter: Date;
}

export type VerifyResult =
  | { verdict: "AUTHENTIC"; manifest: Manifest; securityLevel: ProofBundle["device"]["securityLevel"]; provenTimeWindow: ProvenTimeWindow }
  | { verdict: "AUTHENTIC_PENDING"; manifest: Manifest; securityLevel: ProofBundle["device"]["securityLevel"] }
  | { verdict: "DEVICE_REVOKED"; manifest: Manifest; compromisedAt: Date; provenTimeWindow: ProvenTimeWindow }
  | { verdict: "INVALID"; reason: string };

/**
 * Verifies a proof bundle against an uploaded file, per docs/PROTOCOL.md §8. `chain` is read from
 * directly — never the Sakshi API — so a malicious or down API can at worst withhold a bundle, not
 * forge a verdict (docs/ARCHITECTURE.md §4, docs/THREAT_MODEL.md T10/T11).
 */
export async function verifyBundle(fileBytes: Uint8Array, bundle: ProofBundle, chain: ChainReader): Promise<VerifyResult> {
  const fileHashHex = Array.from(await sha256(fileBytes), (b) => b.toString(16).padStart(2, "0")).join("");

  const manifestBytes = fromBase64(bundle.manifest);
  const signatureDer = fromBase64(bundle.signature);

  const parsed = parseManifestBytes(manifestBytes);
  if (!parsed.ok) {
    return { verdict: "INVALID", reason: `manifest ${parsed.error.toLowerCase()}` };
  }
  const { manifest } = parsed;

  if (manifest.sha256 !== fileHashHex) {
    return { verdict: "INVALID", reason: "file hash does not match manifest" };
  }

  const publicKeySpki = fromBase64(bundle.device.publicKey);
  const signatureValid = await verifyP256Signature(publicKeySpki, manifestBytes, signatureDer);
  if (!signatureValid) {
    return { verdict: "INVALID", reason: "signature does not verify against device public key" };
  }

  // Step 6 (attestation chain -> Google root) is P2; the bundle's claimed securityLevel is trusted for now.

  if (!bundle.anchor) {
    return { verdict: "AUTHENTIC_PENDING", manifest, securityLevel: bundle.device.securityLevel };
  }
  const { anchor } = bundle;

  const manifestDigest = toHex0x(await sha256(manifestBytes));
  const signatureDigest = toHex0x(await sha256(signatureDer));
  const leaf: [string, string] = [manifestDigest, signatureDigest];

  if (!verifyCaptureInclusion(anchor.root, leaf, anchor.proof)) {
    return { verdict: "INVALID", reason: "Merkle proof does not include this capture under the claimed root" };
  }

  const onchainBatch = await chain.getBatch(anchor.contract, anchor.batchId);
  if (!onchainBatch || onchainBatch.root.toLowerCase() !== anchor.root.toLowerCase()) {
    return { verdict: "INVALID", reason: "on-chain root does not match the bundle's claimed root" };
  }

  let notBefore: Date | undefined;
  if (manifest.beacon) {
    const block = await chain.getBlock(BigInt(manifest.beacon.blockNumber));
    if (!block || block.hash.toLowerCase() !== manifest.beacon.blockHash.toLowerCase()) {
      return { verdict: "INVALID", reason: "time-beacon block hash does not match the chain" };
    }
    notBefore = new Date(Number(block.timestamp) * 1000);
  }

  const provenTimeWindow: ProvenTimeWindow = {
    ...(notBefore ? { notBefore } : {}),
    notAfter: new Date(Number(onchainBatch.timestamp) * 1000),
  };

  const deviceKeyHash = toHex0x(await sha256(publicKeySpki));
  const compromisedAt = await chain.getDeviceCompromisedAt(anchor.contract, deviceKeyHash);
  if (compromisedAt !== 0n && onchainBatch.timestamp >= compromisedAt) {
    return {
      verdict: "DEVICE_REVOKED",
      manifest,
      compromisedAt: new Date(Number(compromisedAt) * 1000),
      provenTimeWindow,
    };
  }

  return { verdict: "AUTHENTIC", manifest, securityLevel: bundle.device.securityLevel, provenTimeWindow };
}
