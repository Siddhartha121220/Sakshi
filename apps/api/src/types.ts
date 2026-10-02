// Row shapes matching docs/DATABASE.md, after the camelCase transform in db.ts.
export interface DeviceRow {
  id: string;
  publicKey: Buffer;
  keyHash: Buffer;
  securityLevel: "strongbox" | "tee";
  attestationChain: Buffer[];
  attestationInfo: unknown;
  appVersion: string;
  createdAt: Date;
  lastSeenAt: Date;
  compromisedAt: Date | null;
  revokeReason: number | null;
  revokeTxHash: Buffer | null;
}

export type BatchStatus = "building" | "submitted" | "confirmed" | "finalized" | "failed";

export interface AnchorBatchRow {
  id: string; // bigint comes back as string from postgres.js by default
  merkleRoot: Buffer;
  leafCount: number;
  chainId: number;
  contractAddress: Buffer;
  status: BatchStatus;
  txHash: Buffer | null;
  txNonce: string | null;
  onchainBatchId: string | null;
  blockNumber: string | null;
  blockTimestamp: Date | null;
  error: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  finalizedAt: Date | null;
}

export interface CaptureRow {
  id: string;
  deviceId: string;
  sha256: Buffer;
  manifestBytes: Buffer;
  manifestDigest: Buffer;
  signature: Buffer;
  phash: string; // signed bigint, as returned by postgres.js
  tileHashes: Buffer;
  width: number;
  height: number;
  capturedAtClaimed: Date;
  beaconChainId: number | null;
  beaconBlockNumber: string | null;
  beaconBlockHash: Buffer | null;
  batchId: string | null;
  leafIndex: number | null;
  merkleProof: Buffer[] | null;
  originalObjectKey: string | null;
  publishedAt: Date | null;
  receivedAt: Date;
}

/** Declares the app-specific fields attached to a request by preHandlers (see lib/device-auth.ts). */
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
    device?: DeviceRow;
  }
}
