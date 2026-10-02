import { describe, it, expect } from "vitest";
import { toBase64, toHex0x } from "../src/bytes.js";
import { sha256 } from "../src/sha256.js";
import { buildManifestBytes, type Manifest } from "../src/manifest.js";
import { generateP256KeyPair, exportSpki, signP256AsDer } from "../src/signature.js";
import { buildCaptureMerkleTree, type CaptureLeaf } from "../src/merkle.js";
import { verifyBundle } from "../src/verify.js";
import type { ProofBundle } from "../src/bundle.js";
import type { ChainReader, OnChainBatch, OnChainBlock } from "../src/chain.js";

const CONTRACT = `0x${"11".repeat(20)}`;
const TX_HASH = `0x${"22".repeat(32)}`;

/** A fully valid, self-consistent (file, bundle, chain) triple, with pieces overridable per test. */
async function makeScenario(opts: { withBeacon?: boolean } = {}) {
  const fileBytes = new TextEncoder().encode("fake jpeg bytes for the test");
  const fileHash = Array.from(await sha256(fileBytes), (b) => b.toString(16).padStart(2, "0")).join("");

  const beacon = opts.withBeacon
    ? { chainId: 84532, blockNumber: 1000, blockHash: `0x${"aa".repeat(32)}` }
    : undefined;

  const manifest: Manifest = {
    v: 1,
    type: "sakshi.capture",
    deviceId: "0192f1c2-1234-7890-abcd-ef0123456789",
    sha256: fileHash,
    mime: "image/jpeg",
    width: 100,
    height: 100,
    phash: "0000000000000000",
    tiles: Array.from({ length: 16 }, () => "0000000000000000"),
    capturedAt: "2026-10-02T10:42:13.512Z",
    app: { version: "0.1.0", build: 1 },
    ...(beacon ? { beacon } : {}),
  };
  const manifestBytes = buildManifestBytes(manifest);

  const { publicKey, privateKey } = await generateP256KeyPair();
  const spki = await exportSpki(publicKey);
  const signatureDer = await signP256AsDer(privateKey, manifestBytes);

  const manifestDigest = toHex0x(await sha256(manifestBytes));
  const signatureDigest = toHex0x(await sha256(signatureDer));
  const leaf: CaptureLeaf = [manifestDigest, signatureDigest];
  const fillerLeaf: CaptureLeaf = [`0x${"ff".repeat(32)}`, `0x${"ee".repeat(32)}`];
  const tree = buildCaptureMerkleTree([leaf, fillerLeaf]);
  const index = [...tree.entries()].find(([, v]) => v[0] === leaf[0])![0];
  const proof = tree.getProof(index);

  const anchorTimestamp = 1_700_000_100n;
  const bundle: ProofBundle = {
    format: "sakshi.proof",
    version: 1,
    manifest: toBase64(manifestBytes),
    signature: toBase64(signatureDer),
    device: { publicKey: toBase64(spki), securityLevel: "tee", attestationChain: [] },
    anchor: { chainId: 84532, contract: CONTRACT, batchId: 0, root: tree.root, proof, txHash: TX_HASH },
  };

  const onChainBatch: OnChainBatch = { root: tree.root, timestamp: anchorTimestamp, leafCount: 2 };
  const onChainBlock: OnChainBlock | null = beacon
    ? { hash: beacon.blockHash, timestamp: 1_700_000_000n }
    : null;

  const chain: ChainReader = {
    async getBatch(contract, batchId) {
      if (contract !== CONTRACT || batchId !== 0) return null;
      return onChainBatch;
    },
    async getDeviceCompromisedAt() {
      return 0n;
    },
    async getBlock(blockNumber) {
      if (beacon && blockNumber === BigInt(beacon.blockNumber)) return onChainBlock;
      return null;
    },
  };

  return { fileBytes, manifest, manifestBytes, spki, signatureDer, bundle, chain, anchorTimestamp };
}

describe("verifyBundle: AUTHENTIC path", () => {
  it("returns AUTHENTIC for a valid, anchored bundle with no beacon", async () => {
    const { fileBytes, bundle, chain, anchorTimestamp } = await makeScenario();
    const result = await verifyBundle(fileBytes, bundle, chain);
    expect(result.verdict).toBe("AUTHENTIC");
    if (result.verdict === "AUTHENTIC") {
      expect(result.provenTimeWindow.notAfter.getTime()).toBe(Number(anchorTimestamp) * 1000);
      expect(result.provenTimeWindow.notBefore).toBeUndefined();
      expect(result.securityLevel).toBe("tee");
    }
  });

  it("includes a proven lower time bound when the manifest has a valid beacon", async () => {
    const { fileBytes, bundle, chain } = await makeScenario({ withBeacon: true });
    const result = await verifyBundle(fileBytes, bundle, chain);
    expect(result.verdict).toBe("AUTHENTIC");
    if (result.verdict === "AUTHENTIC") {
      expect(result.provenTimeWindow.notBefore).toBeInstanceOf(Date);
    }
  });
});

describe("verifyBundle: AUTHENTIC_PENDING path", () => {
  it("returns AUTHENTIC_PENDING when the bundle has no anchor yet", async () => {
    const { fileBytes, bundle, chain } = await makeScenario();
    const pending: ProofBundle = { ...bundle, anchor: undefined };
    const result = await verifyBundle(fileBytes, pending, chain);
    expect(result.verdict).toBe("AUTHENTIC_PENDING");
  });
});

describe("verifyBundle: DEVICE_REVOKED path", () => {
  it("returns DEVICE_REVOKED when the device was compromised at or before the anchor time", async () => {
    const { fileBytes, bundle, chain, anchorTimestamp } = await makeScenario();
    const revokedChain: ChainReader = { ...chain, async getDeviceCompromisedAt() { return anchorTimestamp - 10n; } };
    const result = await verifyBundle(fileBytes, bundle, revokedChain);
    expect(result.verdict).toBe("DEVICE_REVOKED");
  });

  it("still returns AUTHENTIC when the device was compromised AFTER this anchor", async () => {
    const { fileBytes, bundle, chain, anchorTimestamp } = await makeScenario();
    const laterRevokedChain: ChainReader = { ...chain, async getDeviceCompromisedAt() { return anchorTimestamp + 10n; } };
    const result = await verifyBundle(fileBytes, bundle, laterRevokedChain);
    expect(result.verdict).toBe("AUTHENTIC");
  });
});

describe("verifyBundle: INVALID paths", () => {
  it("rejects when the uploaded file's hash doesn't match the manifest", async () => {
    const { bundle, chain } = await makeScenario();
    const wrongFile = new TextEncoder().encode("a completely different file");
    const result = await verifyBundle(wrongFile, bundle, chain);
    expect(result.verdict).toBe("INVALID");
  });

  it("rejects a tampered signature", async () => {
    const { fileBytes, bundle, chain } = await makeScenario();
    const sigBytes = Buffer.from(bundle.signature, "base64");
    const lastIndex = sigBytes.length - 1;
    sigBytes[lastIndex] = sigBytes[lastIndex]! ^ 0xff;
    const tampered: ProofBundle = { ...bundle, signature: sigBytes.toString("base64") };
    const result = await verifyBundle(fileBytes, tampered, chain);
    expect(result.verdict).toBe("INVALID");
  });

  it("rejects a bundle signed by a key that doesn't match the device's claimed public key", async () => {
    const { fileBytes, bundle, chain } = await makeScenario();
    const other = await generateP256KeyPair();
    const otherSpki = await exportSpki(other.publicKey);
    const tampered: ProofBundle = { ...bundle, device: { ...bundle.device, publicKey: toBase64(otherSpki) } };
    const result = await verifyBundle(fileBytes, tampered, chain);
    expect(result.verdict).toBe("INVALID");
  });

  it("rejects a Merkle proof that doesn't include this capture", async () => {
    const { fileBytes, bundle, chain } = await makeScenario();
    const tampered: ProofBundle = { ...bundle, anchor: { ...bundle.anchor!, proof: [] } };
    const result = await verifyBundle(fileBytes, tampered, chain);
    expect(result.verdict).toBe("INVALID");
  });

  it("rejects when the on-chain root doesn't match the bundle's claimed root", async () => {
    const { fileBytes, bundle, chain } = await makeScenario();
    const wrongRootChain: ChainReader = {
      ...chain,
      async getBatch() {
        return { root: `0x${"99".repeat(32)}`, timestamp: 1_700_000_100n, leafCount: 2 };
      },
    };
    const result = await verifyBundle(fileBytes, bundle, wrongRootChain);
    expect(result.verdict).toBe("INVALID");
  });

  it("rejects when the batch isn't found on-chain at all", async () => {
    const { fileBytes, bundle, chain } = await makeScenario();
    const emptyChain: ChainReader = { ...chain, async getBatch() { return null; } };
    const result = await verifyBundle(fileBytes, bundle, emptyChain);
    expect(result.verdict).toBe("INVALID");
  });

  it("rejects when the time-beacon block hash doesn't match the chain", async () => {
    const { fileBytes, bundle, chain } = await makeScenario({ withBeacon: true });
    const wrongBeaconChain: ChainReader = {
      ...chain,
      async getBlock() {
        return { hash: `0x${"bb".repeat(32)}`, timestamp: 1_700_000_000n };
      },
    };
    const result = await verifyBundle(fileBytes, bundle, wrongBeaconChain);
    expect(result.verdict).toBe("INVALID");
  });
});
