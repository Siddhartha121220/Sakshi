import { describe, it, expect } from "vitest";
import { buildManifestBytes, toBase64, type Manifest } from "@sakshi/core";
import { loadLinkedProof, parseProofLinkHash } from "../src/lib/proof-link.js";
import type { CaptureSummary } from "../src/lib/api-client.js";

const HASH = "6748c2713490c219a7629935d92c59029a0a8242a0e95b6924d7e3eb726ab0cc";

describe("parseProofLinkHash", () => {
  it("reads the hash from a verification link", () => {
    expect(parseProofLinkHash(`?hash=${HASH}`)).toBe(HASH);
    expect(parseProofLinkHash(`?utm=x&hash=${HASH.toUpperCase()}`)).toBe(HASH);
  });

  it("parses the link the Android app builds", () => {
    // Same string asserted in apps/android/.../VerificationLinkTest.kt.
    const link = new URL(`https://user.github.io/sakshi/?hash=${HASH}`);
    expect(parseProofLinkHash(link.search)).toBe(HASH);
  });

  it("ignores anything that is not exactly a SHA-256 hex digest", () => {
    expect(parseProofLinkHash("")).toBeNull();
    expect(parseProofLinkHash("?hash=")).toBeNull();
    expect(parseProofLinkHash(`?hash=${HASH.slice(0, 63)}`)).toBeNull();
    expect(parseProofLinkHash(`?hash=${HASH}00`)).toBeNull();
    expect(parseProofLinkHash("?hash=../../etc/passwd")).toBeNull();
  });
});

describe("loadLinkedProof", () => {
  const manifest: Manifest = {
    v: 1,
    type: "sakshi.capture",
    deviceId: "998da202-83d4-4d32-90d5-c8fc0752c349",
    sha256: HASH,
    mime: "image/jpeg",
    width: 2448,
    height: 3264,
    phash: "d5ad0ad8f83203e7",
    tiles: Array.from({ length: 16 }, () => "0000000000000000"),
    capturedAt: "2026-10-03T16:09:19.318Z",
    app: { version: "0.1.0", build: 1 },
  };
  const capture: CaptureSummary = {
    captureId: "6bc77bb8-7b55-4af9-b61d-0843495b7a88",
    status: "finalized",
    securityLevel: "tee",
    originalUrl: null,
    bundle: {
      format: "sakshi.proof",
      version: 1,
      manifest: toBase64(buildManifestBytes(manifest)),
      signature: "MEQCIA==",
      device: { publicKey: "AAAA", securityLevel: "tee", attestationChain: [] },
    },
  };

  it("loads the bundle and the photo's (device-clock) capture time", async () => {
    let askedFor = "";
    const linked = await loadLinkedProof(HASH, async (h) => ((askedFor = h), capture));

    expect(askedFor).toBe(HASH);
    expect(linked).toEqual({ kind: "found", bundle: capture.bundle, capturedAt: "2026-10-03T16:09:19.318Z" });
  });

  it("reports a link the server has no proof for", async () => {
    expect(await loadLinkedProof(HASH, async () => null)).toEqual({ kind: "not_found" });
  });

  it("rejects a malformed bundle instead of preloading it", async () => {
    const broken = { ...capture, bundle: { ...capture.bundle, format: "something-else" } } as unknown as CaptureSummary;
    await expect(loadLinkedProof(HASH, async () => broken)).rejects.toThrow();
  });
});
