// Browser-side implementation of @sakshi/core's ChainReader, via viem reading directly from the
// configured RPC — never through the Sakshi API. This is what keeps verification trustless
// (docs/ARCHITECTURE.md §4): the API can at worst withhold a bundle, never forge a verdict, because
// the root/revocation/block-hash checks here never go through it.
import { createPublicClient, http, parseAbi } from "viem";
import type { ChainReader, OnChainBatch, OnChainBlock } from "@sakshi/core";
import { config } from "./config.js";

// Read-only subset of SakshiAnchor.sol — see apps/api/src/chain.ts for the full ABI (including the
// write-side `anchor`/`revokeDevice` the worker needs, which this read-only verifier never calls).
const SAKSHI_ANCHOR_READ_ABI = parseAbi([
  "function batches(uint256) view returns (bytes32 root, uint64 timestamp, uint32 leafCount)",
  "function deviceCompromisedAt(bytes32) view returns (uint64)",
]);

export function createBrowserChainReader(rpcUrl: string = config.rpcUrl, chainId: number = config.chainId): ChainReader {
  const client = createPublicClient({
    transport: http(rpcUrl),
    chain: { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } },
    cacheTime: 0, // see apps/api/README.md's gotchas — viem caches getBlockNumber()/getBlock() otherwise
  });

  return {
    async getBatch(contract, batchId): Promise<OnChainBatch | null> {
      try {
        const [root, timestamp, leafCount] = await client.readContract({
          address: contract as `0x${string}`,
          abi: SAKSHI_ANCHOR_READ_ABI,
          functionName: "batches",
          args: [BigInt(batchId)],
        });
        return { root, timestamp, leafCount };
      } catch {
        return null;
      }
    },

    async getDeviceCompromisedAt(contract, deviceKeyHash): Promise<bigint> {
      return client.readContract({
        address: contract as `0x${string}`,
        abi: SAKSHI_ANCHOR_READ_ABI,
        functionName: "deviceCompromisedAt",
        args: [deviceKeyHash as `0x${string}`],
      });
    },

    async getBlock(blockNumber): Promise<OnChainBlock | null> {
      try {
        const block = await client.getBlock({ blockNumber });
        if (!block.hash) return null;
        return { hash: block.hash, timestamp: block.timestamp };
      } catch {
        return null;
      }
    },
  };
}
