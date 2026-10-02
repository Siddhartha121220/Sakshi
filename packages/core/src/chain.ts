// The minimal read surface verify() needs from a chain. Deliberately not tied to viem or ethers:
// the API and web app (docs/ARCHITECTURE.md §2.2, §2.5) both use viem, but core shouldn't carry
// that dependency just to define an interface — callers adapt their own client to this shape.
// This is also what keeps verify() "trustless": it only ever reads from whatever RPC the caller
// configured, never from the Sakshi API.

// 0x-prefixed hex strings, kept as plain `string` (rather than a `0x${string}` template literal
// type) so values parsed from zod schemas or JSON don't need casts at every call site.

export interface OnChainBatch {
  root: string;
  timestamp: bigint;
  leafCount: number;
}

export interface OnChainBlock {
  hash: string;
  timestamp: bigint;
}

export interface ChainReader {
  /** SakshiAnchor.batches(batchId). Returns null if batchId doesn't exist. */
  getBatch(contract: string, batchId: number): Promise<OnChainBatch | null>;
  /** SakshiAnchor.deviceCompromisedAt(keyHash). Returns 0n if the device was never revoked. */
  getDeviceCompromisedAt(contract: string, deviceKeyHash: string): Promise<bigint>;
  /** eth_getBlockByNumber. Returns null if the block doesn't exist (e.g. not yet mined). */
  getBlock(blockNumber: bigint): Promise<OnChainBlock | null>;
}
