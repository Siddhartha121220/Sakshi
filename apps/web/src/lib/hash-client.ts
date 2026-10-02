// Main-thread entry point for hash-worker.ts (Vite's `new URL(..., import.meta.url)` worker
// pattern — https://vite.dev/guide/features.html#web-workers).
import type { HashRequest, HashResult, HashWorkerResponse } from "./hash-types.js";

export function hashFileInWorker(file: File): Promise<HashResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./hash-worker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (e: MessageEvent<HashWorkerResponse>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };

    const request: HashRequest = { file };
    worker.postMessage(request);
  });
}
