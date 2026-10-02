// Integration test for the web app's own composition (chain-reader.ts + api-client.ts +
// verify-flow.ts) against a REAL running API, worker, and local chain — reusing apps/api's test
// infrastructure rather than re-implementing it (same Anvil + embedded-DB approach as
// apps/api/test/integration.test.ts). This is what stands in for "verify in an actual browser"
// (docs/ROADMAP.md Phase 4 exit criteria) until a real E2E/Playwright pass is worth adding: the
// only browser-only pieces NOT exercised here are image decoding and the Web Worker wrapper
// (hash-worker.ts / image-decode.ts), which are thin, untested browser glue by design — see
// apps/web/README.md.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toHex, sha256, phashFromHex, phashToHex, hammingDistance, type ProofBundle } from "@sakshi/core";
import { buildApp, type AppContext } from "../../api/src/app.js";
import { createDb, type Sql } from "../../api/src/db.js";
import { createLogger } from "../../api/src/logger.js";
import { loadConfig, type Config } from "../../api/src/config.js";
import { createViemPublicClient, createChainReader as createApiChainReader, createAnchorWalletClient } from "../../api/src/chain.js";
import { runAnchorTick, type WorkerDeps } from "../../api/src/worker.js";
import { createTestDb, type TestDb } from "../../api/test/helpers/test-db.js";
import { startAnvil, deploySakshiAnchor, type AnvilInstance, type DeployedContract } from "../../api/test/helpers/anvil.js";
import { registerFakeDevice, submitFakeCapture } from "../../api/test/helpers/fake-device.js";
import { verifyUploadedFile } from "../src/lib/verify-flow.js";
import { createBrowserChainReader } from "../src/lib/chain-reader.js";
import type { HashResult } from "../src/lib/hash-types.js";

let anvil: AnvilInstance;
let contract: DeployedContract;
let testDb: TestDb;
let sql: Sql;
let config: Config;
let baseUrl: string;
let closeApp: () => Promise<void>;
let workerDeps: WorkerDeps;
let chainReader: ReturnType<typeof createBrowserChainReader>;

beforeAll(async () => {
  anvil = await startAnvil();
  contract = await deploySakshiAnchor(anvil);
  testDb = await createTestDb();

  config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: testDb.databaseUrl,
    CHAIN_ID: String(anvil.chainId),
    RPC_URL: anvil.rpcUrl,
    SAKSHI_ANCHOR_CONTRACT: contract.address,
    ANCHORER_PRIVATE_KEY: contract.anchorer.privateKey,
    SERVER_CHALLENGE_SECRET: "test-secret-at-least-16-bytes",
    DEV_SKIP_ATTESTATION: "true",
    FINALITY_FALLBACK_CONFIRMATIONS: "0",
  });

  sql = createDb(config.DATABASE_URL);
  const logger = createLogger(config);
  const publicClient = createViemPublicClient(config);
  const apiCtx: AppContext = { config, sql, logger, chainReader: createApiChainReader(publicClient), publicClient };

  const app = buildApp(apiCtx);
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  closeApp = () => app.close();

  const wallet = createAnchorWalletClient(config);
  workerDeps = { sql, logger, config, wallet };

  // The web app's own chain reader, pointed at the same local chain — this (not apiCtx.chainReader)
  // is what the tests below exercise, since it's the thing apps/web actually ships.
  chainReader = createBrowserChainReader(anvil.rpcUrl, anvil.chainId);
}, 30_000);

afterAll(async () => {
  await closeApp();
  await sql.end();
  await testDb.close();
  await anvil.stop();
});

async function anchorUntilFinalized(captureId: string, maxTicks = 15): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    await runAnchorTick(workerDeps);
    const [row] = await sql<{ status: string | null }[]>`
      select b.status from captures c left join anchor_batches b on b.id = c.batch_id where c.id = ${captureId}
    `;
    if (row?.status === "finalized") return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`capture ${captureId} did not reach 'finalized' within ${maxTicks} ticks`);
}

function hashResultFor(photoBytes: Uint8Array): Promise<HashResult> {
  // Stands in for hash-worker.ts's output without needing real image decoding (see file header) —
  // the fake device's "photo" is 32 random bytes, not a real image, so there's no phash to compute.
  return sha256(photoBytes).then((digest) => ({ sha256Hex: toHex(digest), phashHex: null, tileHashesHex: null, width: 0, height: 0 }));
}

describe("web verify-flow against a real API + chain", () => {
  it("AUTHENTIC: an anchored capture verifies via the exact path", async () => {
    const device = await registerFakeDevice(baseUrl);
    const { captureId, photoBytes } = await submitFakeCapture(baseUrl, device);
    await anchorUntilFinalized(captureId);

    const hash = await hashResultFor(photoBytes);
    const { verdict, bundle } = await verifyUploadedFile(photoBytes, hash, { chainReader, apiBaseUrl: baseUrl });

    expect(verdict.verdict).toBe("AUTHENTIC");
    expect(bundle?.anchor).toBeDefined();
  });

  it("NO_PROVENANCE: a file with no matching capture and no phash", async () => {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const hash = await hashResultFor(randomBytes);
    const { verdict } = await verifyUploadedFile(randomBytes, hash, { chainReader, apiBaseUrl: baseUrl });
    expect(verdict.verdict).toBe("NO_PROVENANCE");
  });

  it("bundle-file path: verifies using a provided bundle without needing the API reachable at all", async () => {
    const device = await registerFakeDevice(baseUrl);
    const { captureId, photoBytes } = await submitFakeCapture(baseUrl, device);
    await anchorUntilFinalized(captureId);

    const res = await fetch(`${baseUrl}/v1/captures/${captureId}`);
    const { bundle } = (await res.json()) as { bundle: ProofBundle };

    const hash = await hashResultFor(photoBytes);
    // A deliberately unreachable API base URL: if this succeeds, the provided bundle really did
    // skip the API lookup (docs/PROTOCOL.md §8 step 2), not just happen to also work.
    const { verdict } = await verifyUploadedFile(photoBytes, hash, { chainReader, apiBaseUrl: "http://127.0.0.1:1" }, bundle);
    expect(verdict.verdict).toBe("AUTHENTIC");
  });

  it("LOOKUP_FAILED: surfaces a network error distinctly from NO_PROVENANCE", async () => {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const hash = await hashResultFor(randomBytes);
    const { verdict } = await verifyUploadedFile(randomBytes, hash, { chainReader, apiBaseUrl: "http://127.0.0.1:1" });
    expect(verdict.verdict).toBe("LOOKUP_FAILED");
  });

  it("SIMILAR_TO_AUTHENTIC: a close (but not exact) pHash match to an anchored capture", async () => {
    const device = await registerFakeDevice(baseUrl);
    // fake-device.ts submits phash "0000000000000000"; craft an uploaded file whose own phash is
    // close (not identical) to that, simulating a recompressed copy without real image decoding.
    const { captureId, photoBytes } = await submitFakeCapture(baseUrl, device);
    await anchorUntilFinalized(captureId);

    const nearbyPhash = phashToHex(phashFromHex("0000000000000000") ^ 0b111n); // distance 3
    expect(hammingDistance(phashFromHex(nearbyPhash), phashFromHex("0000000000000000"))).toBeLessThanOrEqual(14);

    const uploadedBytes = crypto.getRandomValues(new Uint8Array(32)); // different file, different sha256
    const hash: HashResult = { sha256Hex: toHex(await sha256(uploadedBytes)), phashHex: nearbyPhash, tileHashesHex: null, width: 100, height: 100 };

    const { verdict } = await verifyUploadedFile(uploadedBytes, hash, { chainReader, apiBaseUrl: baseUrl });
    expect(verdict.verdict).toBe("SIMILAR_TO_AUTHENTIC");
    if (verdict.verdict === "SIMILAR_TO_AUTHENTIC") {
      // Not necessarily THIS test's own capture: every fake-device capture in this file shares the
      // same fixed phash ("0000000000000000"), so any of them is a legitimate distance-3 match —
      // the point of this test is that the perceptual path finds and verifies *a* genuine one.
      expect(verdict.capture.captureId.length).toBeGreaterThan(0);
      expect(verdict.distance).toBe(3);
    }
  });
});
