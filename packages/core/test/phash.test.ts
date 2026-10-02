import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  toLuma,
  computeGlobalPHash,
  computeTileHashes,
  hammingDistance,
  phashToHex,
  phashFromHex,
  isHashable,
  type RgbImage,
} from "../src/phash.js";
import { toHex } from "../src/bytes.js";

const vectors = JSON.parse(readFileSync(join(import.meta.dirname, "..", "test-vectors", "phash.json"), "utf8")) as Array<{
  name: string;
  width: number;
  height: number;
  rgbBase64: string;
  expectedGlobalPHashHex: string;
  expectedTileHashesHex: string[];
}>;

function loadImage(v: (typeof vectors)[number]): RgbImage {
  return { width: v.width, height: v.height, rgb: new Uint8Array(Buffer.from(v.rgbBase64, "base64")) };
}

describe("perceptual hash (golden vectors)", () => {
  for (const v of vectors) {
    it(`matches the golden global pHash: ${v.name}`, () => {
      const img = loadImage(v);
      const luma = toLuma(img);
      const hash = computeGlobalPHash(luma, img.width, img.height);
      expect(phashToHex(hash)).toBe(v.expectedGlobalPHashHex);
    });

    it(`matches the golden tile hashes: ${v.name}`, () => {
      const img = loadImage(v);
      const luma = toLuma(img);
      const tiles = computeTileHashes(luma, img.width, img.height);
      expect(tiles.length).toBe(128); // 16 tiles x 8 bytes
      const hex = Array.from({ length: 16 }, (_, i) => toHex(tiles.slice(i * 8, i * 8 + 8)));
      expect(hex).toEqual(v.expectedTileHashesHex);
    });
  }
});

describe("perceptual hash (properties)", () => {
  it("is deterministic: hashing the same image twice gives the same hash", () => {
    const v = vectors[0]!;
    const img = loadImage(v);
    const h1 = computeGlobalPHash(toLuma(img), img.width, img.height);
    const h2 = computeGlobalPHash(toLuma(img), img.width, img.height);
    expect(h1).toBe(h2);
  });

  it("hamming distance of a hash to itself is 0", () => {
    const v = vectors[0]!;
    const img = loadImage(v);
    const h = computeGlobalPHash(toLuma(img), img.width, img.height);
    expect(hammingDistance(h, h)).toBe(0);
  });

  it("hamming distance is symmetric and within [0, 64]", () => {
    const a = computeGlobalPHash(toLuma(loadImage(vectors[0]!)), vectors[0]!.width, vectors[0]!.height);
    const b = computeGlobalPHash(toLuma(loadImage(vectors[1]!)), vectors[1]!.width, vectors[1]!.height);
    const d1 = hammingDistance(a, b);
    const d2 = hammingDistance(b, a);
    expect(d1).toBe(d2);
    expect(d1).toBeGreaterThanOrEqual(0);
    expect(d1).toBeLessThanOrEqual(64);
  });

  it("visually distinct images (checkerboard vs. gradient) land far apart", () => {
    const checkerboard = vectors.find((v) => v.name === "checkerboard-8")!;
    const gradient = vectors.find((v) => v.name === "horizontal-gradient")!;
    const a = phashFromHex(checkerboard.expectedGlobalPHashHex);
    const b = phashFromHex(gradient.expectedGlobalPHashHex);
    // Not a strict correctness requirement, just documents expected separation for calibration
    // (see docs/ROADMAP.md Phase 7, where real thresholds get calibrated against real photos).
    expect(hammingDistance(a, b)).toBeGreaterThan(14);
  });

  it("hex round-trips through phashToHex/phashFromHex", () => {
    const h = 0x123456789abcdef0n;
    expect(phashFromHex(phashToHex(h))).toBe(h);
  });

  it("rejects images smaller than the minimum hashable dimension", () => {
    expect(isHashable(64, 64)).toBe(true);
    expect(isHashable(63, 64)).toBe(false);
    expect(isHashable(64, 10)).toBe(false);
  });
});
