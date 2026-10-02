// End-to-end integration test — docs/ROADMAP.md Phase 3 exit criteria: a fake device registers,
// submits captures, the anchor worker batches and anchors them on a real (local) chain, and the
// result verifies as AUTHENTIC using @sakshi/core's verifyBundle against that chain directly —
// never through the API, so this also proves the "don't trust the server" property end to end.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildManifestBytes, sha256, signP256AsDer, toBase64, toHex, toHex0x, verifyBundle, type ProofBundle } from "@sakshi/core";
import { buildApp, type AppContext } from "../src/app.js";
import { createDb, type Sql } from "../src/db.js";
import { createLogger } from "../src/logger.js";
import { loadConfig, type Config } from "../src/config.js";
import { createViemPublicClient, createChainReader, createAnchorWalletClient, makeChain, SAKSHI_ANCHOR_ABI } from "../src/chain.js";
import { runAnchorTick, type WorkerDeps } from "../src/worker.js";
import { createTestDb, type TestDb } from "./helpers/test-db.js";
import { startAnvil, deploySakshiAnchor, type AnvilInstance, type DeployedContract } from "./helpers/anvil.js";
import { registerFakeDevice, submitFakeCapture } from "./helpers/fake-device.js";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

let anvil: AnvilInstance;
let contract: DeployedContract;
let testDb: TestDb;
let sql: Sql;
let config: Config;
let baseUrl: string;
let closeApp: () => Promise<void>;
let workerDeps: WorkerDeps;

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
  const chainReader = createChainReader(publicClient);
  const ctx: AppContext = { config, sql, logger, chainReader, publicClient };

  const app = buildApp(ctx);
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  closeApp = () => app.close();

  const wallet = createAnchorWalletClient(config);
  workerDeps = { sql, logger, config, wallet };
}, 30_000);

afterAll(async () => {
  await closeApp();
  await sql.end();
  await testDb.close();
  await anvil.stop();
});

/** Drives the worker until the given capture's batch reaches 'finalized', or throws on timeout. */
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

describe("end-to-end: register, submit, anchor, verify", () => {
  it("anchors a capture and verifies it as AUTHENTIC via verifyBundle (not through the API)", async () => {
    const device = await registerFakeDevice(baseUrl);
    const { captureId, status, photoBytes } = await submitFakeCapture(baseUrl, device, { withBeacon: true });
    expect(status).toBe("pending");

    await anchorUntilFinalized(captureId);

    const res = await fetch(`${baseUrl}/v1/captures/${captureId}`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { status: string; bundle: ProofBundle };
    expect(body.status).toBe("finalized");
    expect(body.bundle.anchor).toBeDefined();

    const chainReader = createChainReader(createViemPublicClient(config));
    const verdict = await verifyBundle(photoBytes, body.bundle, chainReader);

    expect(verdict.verdict).toBe("AUTHENTIC");
    if (verdict.verdict === "AUTHENTIC") {
      expect(verdict.provenTimeWindow.notBefore).toBeInstanceOf(Date); // withBeacon: true above
      expect(verdict.provenTimeWindow.notAfter.getTime()).toBeLessThanOrEqual(Date.now() + 5000);
    }
  });

  it("batches multiple pending captures into a single anchor", async () => {
    const device = await registerFakeDevice(baseUrl);
    // Sequential, not Promise.all: the test DB (PGlite behind a single socket, see
    // test/helpers/test-db.ts) isn't meant for real concurrent connections — the real Postgres
    // this stands in for handles concurrent writes fine, this is a test-double limitation only.
    const submissions = [
      await submitFakeCapture(baseUrl, device),
      await submitFakeCapture(baseUrl, device),
      await submitFakeCapture(baseUrl, device),
    ];

    await anchorUntilFinalized(submissions[0]!.captureId);
    await anchorUntilFinalized(submissions[1]!.captureId);
    await anchorUntilFinalized(submissions[2]!.captureId);

    const bundles: ProofBundle[] = [];
    for (const s of submissions) {
      const res = await fetch(`${baseUrl}/v1/captures/${s.captureId}`);
      bundles.push(((await res.json()) as { bundle: ProofBundle }).bundle);
    }
    const batchIds = new Set(bundles.map((b) => b.anchor!.batchId));
    expect(batchIds.size).toBe(1); // all three landed in the same batch

    const chainReader = createChainReader(createViemPublicClient(config));
    for (const [i, bundle] of bundles.entries()) {
      const verdict = await verifyBundle(submissions[i]!.photoBytes, bundle, chainReader);
      expect(verdict.verdict).toBe("AUTHENTIC");
    }
  });

  it("rejects a second submission of the same image hash from a different device", async () => {
    const deviceA = await registerFakeDevice(baseUrl);
    const deviceB = await registerFakeDevice(baseUrl);

    const { photoBytes } = await submitFakeCapture(baseUrl, deviceA);
    // Re-submit the exact same manifest/signature content is hard to force through the helper, so
    // instead prove the DB-level uniqueness constraint the route relies on: resubmitting the same
    // sha256 from deviceB must be rejected even though deviceB's own signature is perfectly valid.
    const sha256Hex = toHex(await sha256(photoBytes));
    const manifest = {
      v: 1 as const,
      type: "sakshi.capture" as const,
      deviceId: deviceB.deviceId,
      sha256: sha256Hex,
      mime: "image/jpeg",
      width: 100,
      height: 100,
      phash: "0000000000000000",
      tiles: Array.from({ length: 16 }, () => "0000000000000000"),
      capturedAt: new Date().toISOString(),
      app: { version: "0.1.0-fake", build: 1 },
    };
    const manifestBytes = buildManifestBytes(manifest);
    const signatureDer = await signP256AsDer(deviceB.privateKey, manifestBytes);
    const bodyBytes = new TextEncoder().encode(JSON.stringify({ manifest: toBase64(manifestBytes), signature: toBase64(signatureDer) }));
    const timestamp = Math.floor(Date.now() / 1000);
    const canonicalRequest = `POST\n/v1/captures\n${timestamp}\n${toHex(await sha256(bodyBytes))}`;
    const reqSig = await signP256AsDer(deviceB.privateKey, new TextEncoder().encode(canonicalRequest));

    const res = await fetch(`${baseUrl}/v1/captures`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sakshi-device": deviceB.deviceId,
        "x-sakshi-timestamp": String(timestamp),
        "x-sakshi-signature": toBase64(reqSig),
      },
      body: bodyBytes,
    });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("DUPLICATE_IMAGE");
  });

  // Device registration with a genuinely bad/missing attestation is covered by
  // test/attestation.test.ts (DEV_SKIP_ATTESTATION, needed for the fake device above to register
  // at all, would make that assertion meaningless against this running app).

  it("reports DEVICE_REVOKED for a capture anchored after its device's key was revoked on-chain", async () => {
    const device = await registerFakeDevice(baseUrl);
    const { captureId, photoBytes } = await submitFakeCapture(baseUrl, device);

    // Revoke the device directly on-chain, as an operator would (docs/PROTOCOL.md: revokeDevice).
    const deviceKeyHash = toHex0x(await sha256(device.publicKeySpki)) as `0x${string}`;
    const revokerAccount = privateKeyToAccount(contract.revoker.privateKey);
    const revokerClient = createWalletClient({ account: revokerAccount, chain: makeChain(anvil.chainId), transport: http(anvil.rpcUrl) });
    const compromisedAt = Math.floor(Date.now() / 1000) - 1; // just before the anchor that's about to happen
    const hash = await revokerClient.writeContract({
      address: contract.address,
      abi: SAKSHI_ANCHOR_ABI,
      functionName: "revokeDevice",
      args: [deviceKeyHash, BigInt(compromisedAt), 1],
    });
    await createViemPublicClient(config).waitForTransactionReceipt({ hash });

    await anchorUntilFinalized(captureId);

    const res = await fetch(`${baseUrl}/v1/captures/${captureId}`);
    const body = (await res.json()) as { bundle: ProofBundle };
    const chainReader = createChainReader(createViemPublicClient(config));
    const verdict = await verifyBundle(photoBytes, body.bundle, chainReader);

    expect(verdict.verdict).toBe("DEVICE_REVOKED");
  });
});
