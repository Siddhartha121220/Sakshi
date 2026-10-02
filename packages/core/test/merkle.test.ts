import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCaptureMerkleTree, verifyCaptureInclusion, type CaptureLeaf } from "../src/merkle.js";

const vector = JSON.parse(readFileSync(join(import.meta.dirname, "..", "test-vectors", "merkle.json"), "utf8")) as {
  leaves: CaptureLeaf[];
  root: string;
  entries: Array<{ index: number; leaf: CaptureLeaf; proof: string[] }>;
};

describe("Merkle tree (golden vector)", () => {
  it("rebuilds the same root from the same leaves", () => {
    const tree = buildCaptureMerkleTree(vector.leaves);
    expect(tree.root).toBe(vector.root);
  });

  for (const entry of vector.entries) {
    it(`verifies the stored proof for leaf ${entry.index}`, () => {
      expect(verifyCaptureInclusion(vector.root, entry.leaf, entry.proof)).toBe(true);
    });
  }
});

describe("Merkle tree (negative cases)", () => {
  it("rejects a proof checked against the wrong leaf", () => {
    const [first, second] = vector.entries;
    expect(verifyCaptureInclusion(vector.root, second!.leaf, first!.proof)).toBe(false);
  });

  it("rejects a proof checked against a tampered root", () => {
    const entry = vector.entries[0]!;
    const tamperedRoot = ("0x" + "00".repeat(32)) as string;
    expect(verifyCaptureInclusion(tamperedRoot, entry.leaf, entry.proof)).toBe(false);
  });

  it("rejects a leaf that was never in the tree", () => {
    const fakeLeaf: CaptureLeaf = [`0x${"ff".repeat(32)}`, `0x${"ee".repeat(32)}`];
    expect(verifyCaptureInclusion(vector.root, fakeLeaf, vector.entries[0]!.proof)).toBe(false);
  });

  it("rejects a truncated proof", () => {
    const entry = vector.entries.find((e) => e.proof.length > 0)!;
    expect(verifyCaptureInclusion(vector.root, entry.leaf, entry.proof.slice(0, -1))).toBe(false);
  });
});
