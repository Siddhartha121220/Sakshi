// Merkle leaf/proof handling: docs/PROTOCOL.md §4.
//
// Leaves are the standard OpenZeppelin encoding ["bytes32", "bytes32"] over
// [manifestDigest, signatureDigest]. We lean on @openzeppelin/merkle-tree for both building trees
// (the anchor worker, apps/api) and verifying proofs (here) rather than hand-rolling ABI encoding
// and keccak256 — it's the exact library the contract's MerkleProof.sol is designed to pair with,
// so using anything else risks a subtle leaf-encoding mismatch.
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

export const LEAF_ENCODING = ["bytes32", "bytes32"] as const;

/** A 0x-prefixed 32-byte hex string, as @openzeppelin/merkle-tree represents bytes32 values. */
export type CaptureLeaf = [manifestDigest: string, signatureDigest: string];

/** Builds a Merkle tree over a batch of captures (used by the anchor worker, not by verifiers). */
export function buildCaptureMerkleTree(leaves: CaptureLeaf[]) {
  return StandardMerkleTree.of(leaves, [...LEAF_ENCODING]);
}

/**
 * Verifies that `leaf` is included under `root` given `proof`. This is docs/PROTOCOL.md §8 step 9,
 * and matches exactly what SakshiAnchor.verify() checks on-chain (packages/contracts), so a
 * verifier can do this check locally without a chain call, then separately confirm the root itself
 * is the one actually anchored on-chain (step 10).
 */
export function verifyCaptureInclusion(root: string, leaf: CaptureLeaf, proof: string[]): boolean {
  return StandardMerkleTree.verify(root, [...LEAF_ENCODING], leaf, proof);
}
