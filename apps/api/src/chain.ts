// viem wiring for SakshiAnchor.sol. This is the one place viem is imported — it implements
// @sakshi/core's ChainReader interface so core itself stays dependency-light (CONTRIBUTING.md,
// packages/core/src/chain.ts). The same pattern the web verifier (Phase 4) will reuse.
import { createPublicClient, createWalletClient, http, parseAbi, type Chain, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainReader, OnChainBatch, OnChainBlock } from "@sakshi/core";
import type { Config } from "./config.js";

/** A minimal but properly-typed viem Chain — we never need gas-token metadata or block explorer
 *  links beyond the id, but a `{ id } as never` cast (instead of this) poisons viem's generics and
 *  breaks type inference on every subsequent client call. */
export function makeChain(chainId: number): Chain {
  return {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [] } },
  };
}

export const SAKSHI_ANCHOR_ABI = parseAbi([
  "function anchor(bytes32 root, uint32 leafCount) returns (uint256)",
  "function revokeDevice(bytes32 deviceKeyHash, uint64 compromisedAt, uint8 reason)",
  "function verify(uint256 batchId, bytes32[] proof, bytes32 leaf) view returns (bool)",
  "function batchCount() view returns (uint256)",
  "function batches(uint256) view returns (bytes32 root, uint64 timestamp, uint32 leafCount)",
  "function deviceCompromisedAt(bytes32) view returns (uint64)",
  "event RootAnchored(uint256 indexed batchId, bytes32 indexed root, uint32 leafCount, uint64 timestamp)",
  "event DeviceRevoked(bytes32 indexed deviceKeyHash, uint64 compromisedAt, uint8 reason)",
]);

export function createViemPublicClient(config: Pick<Config, "RPC_URL" | "CHAIN_ID">) {
  return createPublicClient({
    transport: http(config.RPC_URL),
    chain: makeChain(config.CHAIN_ID),
    // viem caches getBlockNumber() (and the 'latest' block) for a few seconds by default. The
    // anchor worker calls this every tick to decide finality, so a stale cache would make it think
    // the chain hasn't moved — always read fresh instead (docs/ARCHITECTURE.md §3.3).
    cacheTime: 0,
  });
}

/** Implements @sakshi/core's ChainReader by reading SakshiAnchor via viem. Used by verify(). */
export function createChainReader(
  publicClient: ReturnType<typeof createViemPublicClient>,
): ChainReader {
  return {
    async getBatch(contract, batchId): Promise<OnChainBatch | null> {
      try {
        const [root, timestamp, leafCount] = await publicClient.readContract({
          address: contract as `0x${string}`,
          abi: SAKSHI_ANCHOR_ABI,
          functionName: "batches",
          args: [BigInt(batchId)],
        });
        return { root, timestamp, leafCount };
      } catch {
        return null; // out-of-range batchId reverts — treated as "doesn't exist"
      }
    },

    async getDeviceCompromisedAt(contract, deviceKeyHash): Promise<bigint> {
      return publicClient.readContract({
        address: contract as `0x${string}`,
        abi: SAKSHI_ANCHOR_ABI,
        functionName: "deviceCompromisedAt",
        args: [deviceKeyHash as `0x${string}`],
      });
    },

    async getBlock(blockNumber): Promise<OnChainBlock | null> {
      try {
        const block = await publicClient.getBlock({ blockNumber });
        if (!block.hash) return null; // pending block has a null hash
        return { hash: block.hash, timestamp: block.timestamp };
      } catch {
        return null;
      }
    },
  };
}

/** The anchor worker's write access: anchoring batches and revoking devices. */
export function createAnchorWalletClient(config: Pick<Config, "RPC_URL" | "CHAIN_ID" | "ANCHORER_PRIVATE_KEY">) {
  if (!config.ANCHORER_PRIVATE_KEY) {
    throw new Error("ANCHORER_PRIVATE_KEY is required to create the anchor wallet client");
  }
  const account = privateKeyToAccount(config.ANCHORER_PRIVATE_KEY as `0x${string}`);
  const chain = makeChain(config.CHAIN_ID);
  const walletClient = createWalletClient({ account, chain, transport: http(config.RPC_URL) });
  const publicClient = createViemPublicClient(config);

  return {
    account,
    publicClient,
    async anchor(
      contract: `0x${string}`,
      root: `0x${string}`,
      leafCount: number,
      opts: { nonce?: number; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {},
    ): Promise<Hash> {
      return walletClient.writeContract({
        address: contract,
        abi: SAKSHI_ANCHOR_ABI,
        functionName: "anchor",
        args: [root, leafCount],
        ...(opts.nonce !== undefined ? { nonce: opts.nonce } : {}),
        ...(opts.maxFeePerGas !== undefined
          ? { maxFeePerGas: opts.maxFeePerGas, maxPriorityFeePerGas: opts.maxPriorityFeePerGas! }
          : {}),
      });
    },
  };
}
