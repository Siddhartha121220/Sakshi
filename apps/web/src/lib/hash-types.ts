// Shared between the main thread and the hashing worker.
export interface HashRequest {
  file: File;
}

export interface HashResult {
  sha256Hex: string;
  /** null when the image is smaller than the minimum hashable dimension (docs/PROTOCOL.md §5.0). */
  phashHex: string | null;
  tileHashesHex: string[] | null;
  width: number;
  height: number;
}

export type HashWorkerResponse = { ok: true; result: HashResult } | { ok: false; error: string };
