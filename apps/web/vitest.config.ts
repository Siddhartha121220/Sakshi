import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // pure-logic tests only (see test/README or each file's header comment).
    // Browser-only glue is covered where its contract can be faked faithfully in Node:
    // image-decode.ts has test/image-decode.test.ts (added after leaving it untested shipped a bug
    // that broke every upload). hash-worker.ts's own Worker plumbing is still manual-check only.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
