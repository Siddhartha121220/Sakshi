// Runs off the main thread (docs/ROADMAP.md Phase 4) so hashing a large photo never freezes the
// UI. `self` is typed via a small local cast rather than TS's "webworker" lib, which conflicts with
// the "DOM" lib the rest of the app needs — see apps/web/README.md.
import { sha256, toHex, computeGlobalPHash, computeTileHashes, phashToHex, isHashable, toLuma } from "@sakshi/core";
import { decodeImageFile } from "./image-decode.js";
import type { HashRequest, HashWorkerResponse } from "./hash-types.js";

const worker = self as unknown as {
  onmessage: ((e: MessageEvent<HashRequest>) => void) | null;
  postMessage: (msg: HashWorkerResponse) => void;
};

worker.onmessage = async (e) => {
  try {
    const { file } = e.data;
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const sha256Hex = toHex(await sha256(fileBytes));

    const image = await decodeImageFile(file);
    let phashHex: string | null = null;
    let tileHashesHex: string[] | null = null;
    if (isHashable(image.width, image.height)) {
      const luma = toLuma(image);
      phashHex = phashToHex(computeGlobalPHash(luma, image.width, image.height));
      const tiles = computeTileHashes(luma, image.width, image.height);
      tileHashesHex = Array.from({ length: 16 }, (_, i) => toHex(tiles.slice(i * 8, i * 8 + 8)));
    }

    worker.postMessage({ ok: true, result: { sha256Hex, phashHex, tileHashesHex, width: image.width, height: image.height } });
  } catch (err) {
    worker.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
