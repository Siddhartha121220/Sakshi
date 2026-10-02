import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000, // spinning up Anvil + PGlite is slower than a typical unit test
    hookTimeout: 30_000,
    fileParallelism: false, // each test file starts its own Anvil on a fresh port; keep CPU usage sane
  },
});
