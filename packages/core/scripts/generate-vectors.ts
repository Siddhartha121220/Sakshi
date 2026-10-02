// Generates packages/core/test-vectors/*.json — the shared known-answer vectors that both the
// TypeScript and (future) Kotlin implementations are tested against, per docs/PROTOCOL.md and
// docs/ROADMAP.md Phase 2. Run with `pnpm --filter @sakshi/core generate-vectors` after any change
// to jcs/phash/merkle/signature-encoding logic, and commit the resulting JSON.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { jcsEncode } from "../src/jcs.js";
import { toHex, toHex0x, fromHex } from "../src/bytes.js";
import { derToRawSignature, rawToDerSignature } from "../src/signature.js";
import { computeGlobalPHash, computeTileHashes, phashToHex, toLuma, type RgbImage } from "../src/phash.js";
import { buildCaptureMerkleTree, verifyCaptureInclusion } from "../src/merkle.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "test-vectors");
mkdirSync(outDir, { recursive: true });

function write(name: string, data: unknown) {
  writeFileSync(join(outDir, name), JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote ${name}`);
}

// ---------- 1. JCS (RFC 8785) ----------
// Canonicalisation must be byte-identical across implementations: key sorting, no whitespace,
// and (critically) ECMA-262-compatible number formatting. Cases chosen to exercise each of those.
const jcsCases = [
  { name: "key-reordering", input: { b: 1, a: 2, c: { z: 1, y: 2 } } },
  { name: "unicode", input: { greeting: "héllo wörld éè", emoji: "📸" } },
  { name: "integers-and-floats", input: { zero: 0, negative: -5, one: 1.0, pi: 3.14159 } },
  { name: "nested-arrays", input: { tiles: ["a1b2", "c3d4"], nested: [{ x: 1 }, { y: 2 }] } },
  {
    name: "manifest-shaped",
    input: {
      v: 1,
      type: "sakshi.capture",
      deviceId: "0192f1c2-1234-7890-abcd-ef0123456789",
      sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      mime: "image/jpeg",
      width: 4000,
      height: 3000,
      phash: "c3a1000000000000",
      tiles: Array.from({ length: 16 }, (_, i) => i.toString(16).padStart(16, "0")),
      capturedAt: "2026-10-02T10:42:13.512Z",
      app: { version: "0.1.0", build: 1 },
    },
  },
] as const;

write(
  "jcs.json",
  jcsCases.map((c) => ({
    name: c.name,
    input: c.input,
    canonicalUtf8Hex: toHex(jcsEncode(c.input)),
  })),
);

// ---------- 2. Signature DER <-> raw encoding ----------
// These are pure encoding-format vectors (no real signing): they pin the ASN.1 DER representation
// for known raw (r, s) pairs, including the two edge cases that are easy to get wrong — a
// high-bit-set coordinate (needs a 0x00 DER pad byte) and a coordinate with leading zero bytes.
const sigCases = [
  { name: "all-0x01", r: "01".repeat(32), s: "02".repeat(32) },
  { name: "high-bit-set", r: "ff".repeat(32), s: "80" + "00".repeat(31) },
  { name: "leading-zeros", r: "00".repeat(31) + "2a", s: "00".repeat(30) + "0102" },
] as const;

write(
  "signature-encoding.json",
  sigCases.map(({ name, r, s }) => {
    const raw = fromHex(r + s);
    const der = rawToDerSignature(raw);
    const roundTrip = derToRawSignature(der);
    if (toHex(roundTrip) !== toHex(raw)) throw new Error(`round-trip mismatch for ${name}`);
    return { name, rawHex: toHex(raw), derHex: toHex(der) };
  }),
);

// ---------- 3. Perceptual hash ----------
// Synthetic 64x64 images (the minimum hashable size) so this vector file stays small. Each is
// deterministic pure pixel math — no codec involved — so Kotlin must reproduce these exactly.
function makeImage(name: string, width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): RgbImage & { name: string } {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const i = (y * width + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  return { name, width, height, rgb };
}

const images = [
  makeImage("solid-gray", 64, 64, () => [128, 128, 128]),
  makeImage("horizontal-gradient", 64, 64, (x) => [Math.floor((x / 63) * 255), Math.floor((x / 63) * 255), Math.floor((x / 63) * 255)]),
  makeImage("checkerboard-8", 64, 64, (x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? [255, 255, 255] : [0, 0, 0])),
  makeImage("diagonal-stripes", 64, 64, (x, y) => (((x + y) % 16 < 8) ? [200, 50, 50] : [50, 50, 200])),
];

write(
  "phash.json",
  images.map((img) => {
    const luma = toLuma(img);
    const globalHash = computeGlobalPHash(luma, img.width, img.height);
    const tiles = computeTileHashes(luma, img.width, img.height);
    const tileHashes: string[] = [];
    for (let i = 0; i < 16; i++) tileHashes.push(toHex(tiles.slice(i * 8, i * 8 + 8)));
    return {
      name: img.name,
      width: img.width,
      height: img.height,
      rgbBase64: Buffer.from(img.rgb).toString("base64"),
      expectedGlobalPHashHex: phashToHex(globalHash),
      expectedTileHashesHex: tileHashes,
    };
  }),
);

// ---------- 4. Merkle tree ----------
// A fixed 5-leaf batch. Both the root and every leaf's proof must verify, and the library's
// commutative sorted-pair hashing must match what SakshiAnchor.sol (OpenZeppelin MerkleProof) checks.
function fakeDigest(n: number): string {
  const bytes = new Uint8Array(32); // 32 zero bytes with `n` written into the last 4, big-endian
  new DataView(bytes.buffer).setUint32(28, n, false);
  return toHex0x(bytes);
}
const leaves: [string, string][] = Array.from({ length: 5 }, (_, i) => [fakeDigest(i), fakeDigest(i + 100)]);
const tree = buildCaptureMerkleTree(leaves);
const root = tree.root;
const entries = [...tree.entries()].map(([index, leaf]) => {
  const proof = tree.getProof(index);
  if (!verifyCaptureInclusion(root, leaf as [string, string], proof)) {
    throw new Error(`self-check failed for leaf ${index}`);
  }
  return { index, leaf, proof };
});

write("merkle.json", { leafEncoding: ["bytes32", "bytes32"], leaves, root, entries });

console.log("\nAll vectors generated and self-verified.");
