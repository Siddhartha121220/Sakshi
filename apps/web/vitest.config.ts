import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // pure-logic tests only (see test/README or each file's header comment);
    // browser-only glue (image-decode.ts, hash-worker.ts) is intentionally left for manual/E2E checks.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
