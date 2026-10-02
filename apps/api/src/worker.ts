// The anchor worker: docs/ARCHITECTURE.md §3.3. Runs as a separate process from the API
// (`pnpm worker`), ticking on an interval. A Postgres advisory lock means only one instance ever
// anchors at a time, so there's no distributed-lock service to run.
import { pathToFileURL } from "node:url";
import { parseEventLogs, type Hash } from "viem";
import { buildCaptureMerkleTree, sha256, toHex0x, fromHex, type CaptureLeaf } from "@sakshi/core";
import { loadConfig, type Config } from "./config.js";
import { createDb, type Sql } from "./db.js";
import { createLogger, type Logger } from "./logger.js";
import { createAnchorWalletClient, SAKSHI_ANCHOR_ABI } from "./chain.js";
import type { AnchorBatchRow, CaptureRow } from "./types.js";

const ADVISORY_LOCK_KEY = 847_362_910; // arbitrary, stable — just needs to not collide with other locks

export interface WorkerDeps {
  sql: Sql;
  logger: Logger;
  config: Config;
  wallet: ReturnType<typeof createAnchorWalletClient>;
}

/** One tick of the worker loop. Safe to call concurrently from multiple processes — only the
 *  instance that wins the advisory lock does anything. */
export async function runAnchorTick(deps: WorkerDeps): Promise<void> {
  const lockRows = await deps.sql<{ locked: boolean }[]>`select pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) as locked`;
  if (!lockRows[0]?.locked) {
    deps.logger.debug("anchor lock held elsewhere, skipping tick");
    return;
  }
  try {
    await pollFinality(deps);
    await progressInFlightBatch(deps);
    await maybeStartNewBatch(deps);
  } finally {
    await deps.sql`select pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
  }
}

/** Promotes 'confirmed' batches to 'finalized' once the chain agrees they can't be reorged out. */
async function pollFinality(deps: WorkerDeps): Promise<void> {
  const confirmed = await deps.sql<AnchorBatchRow[]>`select * from anchor_batches where status = 'confirmed'`;
  if (confirmed.length === 0) return;

  const latest = await deps.wallet.publicClient.getBlockNumber();
  let finalizedBlockNumber: bigint;
  try {
    const finalizedBlock = await deps.wallet.publicClient.getBlock({ blockTag: "finalized" });
    // ponytail: Anvil doesn't reject the 'finalized' tag — it silently always returns genesis
    // (block 0), which would never satisfy a real batch. Treat "finalized == 0 while the chain has
    // moved on" as "this chain doesn't really support finality" and use the fallback instead.
    // Upgrade path: drop this check once only pointed at real networks with genuine finality.
    finalizedBlockNumber = finalizedBlock.number === 0n && latest > 0n ? -1n : finalizedBlock.number;
  } catch {
    finalizedBlockNumber = -1n; // signal "unsupported", handled below
  }
  if (finalizedBlockNumber < 0n) {
    finalizedBlockNumber = latest - BigInt(deps.config.FINALITY_FALLBACK_CONFIRMATIONS ?? 1);
  }

  for (const batch of confirmed) {
    if (batch.blockNumber && BigInt(batch.blockNumber) <= finalizedBlockNumber) {
      await deps.sql`update anchor_batches set status = 'finalized', finalized_at = now() where id = ${batch.id}`;
      deps.logger.info({ batchId: batch.id }, "batch finalized");
    }
  }
}

/** Resumes whatever's in the single `building`/`submitted` slot, if anything (crash recovery). */
async function progressInFlightBatch(deps: WorkerDeps): Promise<void> {
  const [batch] = await deps.sql<AnchorBatchRow[]>`
    select * from anchor_batches where status in ('building', 'submitted') limit 1
  `;
  if (!batch) return;

  if (batch.status === "building") {
    // We committed the batch+leaf assignments but crashed before sending the transaction. Send it now.
    await sendAnchorTx(deps, batch);
    return;
  }

  // status === 'submitted': check whether it landed.
  const txHash = toHex0x(batch.txHash!) as Hash;
  const receipt = await deps.wallet.publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);

  if (!receipt) {
    const elapsedMs = Date.now() - (batch.submittedAt?.getTime() ?? 0);
    if (elapsedMs > deps.config.ANCHOR_STUCK_TX_TIMEOUT_MS) {
      deps.logger.warn({ batchId: batch.id, txHash }, "anchor tx appears stuck, replacing with higher fees");
      await sendAnchorTx(deps, batch, { replace: true });
    }
    return;
  }

  if (receipt.status === "reverted") {
    deps.logger.error({ batchId: batch.id, txHash }, "anchor tx reverted — requeueing its captures");
    await deps.sql.begin(async (sql) => {
      await sql`update anchor_batches set status = 'failed', error = 'transaction reverted' where id = ${batch.id}`;
      await sql`update captures set batch_id = null, leaf_index = null, merkle_proof = null where batch_id = ${batch.id}`;
    });
    return;
  }

  const [event] = parseEventLogs({ abi: SAKSHI_ANCHOR_ABI, eventName: "RootAnchored", logs: receipt.logs });
  if (!event) {
    deps.logger.error({ batchId: batch.id, txHash }, "anchor tx succeeded but RootAnchored event not found");
    return;
  }

  await deps.sql`
    update anchor_batches
    set status = 'confirmed',
        onchain_batch_id = ${event.args.batchId.toString()},
        block_number = ${receipt.blockNumber.toString()},
        block_timestamp = to_timestamp(${Number(event.args.timestamp)}),
        confirmed_at = now()
    where id = ${batch.id}
  `;
  deps.logger.info({ batchId: batch.id, onchainBatchId: event.args.batchId.toString() }, "batch confirmed");
}

/** If there's no batch in flight and captures are waiting, builds and starts a new one. */
async function maybeStartNewBatch(deps: WorkerDeps): Promise<void> {
  const existsRows = await deps.sql<{ exists: boolean }[]>`
    select exists(select 1 from anchor_batches where status in ('building', 'submitted')) as exists
  `;
  if (existsRows[0]?.exists) return;

  const built = await deps.sql.begin(async (sql) => {
    const pending = await sql<CaptureRow[]>`
      select * from captures where batch_id is null
      order by received_at
      limit ${deps.config.ANCHOR_MAX_BATCH_SIZE}
      for update skip locked
    `;
    if (pending.length === 0) return null;

    const leaves: CaptureLeaf[] = [];
    for (const c of pending) {
      const signatureDigest = toHex0x(await sha256(c.signature));
      leaves.push([toHex0x(c.manifestDigest), signatureDigest]);
    }
    const tree = buildCaptureMerkleTree(leaves);

    const [batch] = await sql<AnchorBatchRow[]>`
      insert into anchor_batches (merkle_root, leaf_count, chain_id, contract_address)
      values (${Buffer.from(fromHex(tree.root))}, ${pending.length}, ${deps.config.CHAIN_ID}, ${Buffer.from(fromHex(deps.config.SAKSHI_ANCHOR_CONTRACT))})
      returning *
    `;

    for (const [index, capture] of pending.entries()) {
      const proof = tree.getProof(index).map((p) => Buffer.from(fromHex(p)));
      await sql`
        update captures set batch_id = ${batch!.id}, leaf_index = ${index}, merkle_proof = ${sql.array(proof)}
        where id = ${capture.id}
      `;
    }

    return batch!;
  });

  if (!built) return; // nothing pending
  deps.logger.info({ batchId: built.id, leafCount: built.leafCount }, "new batch built, sending anchor tx");
  await sendAnchorTx(deps, built);
}

async function sendAnchorTx(deps: WorkerDeps, batch: AnchorBatchRow, opts: { replace?: boolean } = {}): Promise<void> {
  const contract = toHex0x(batch.contractAddress) as `0x${string}`;
  const root = toHex0x(batch.merkleRoot) as `0x${string}`;

  let nonce: number;
  let feeOverrides: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {};
  if (opts.replace && batch.txNonce !== null) {
    nonce = Number(batch.txNonce);
    const fees = await deps.wallet.publicClient.estimateFeesPerGas();
    const bump = (x: bigint) => (x * 125n) / 100n; // +25%, comfortably over the typical 10% minimum bump
    feeOverrides = { maxFeePerGas: bump(fees.maxFeePerGas), maxPriorityFeePerGas: bump(fees.maxPriorityFeePerGas) };
  } else {
    nonce = await deps.wallet.publicClient.getTransactionCount({ address: deps.wallet.account.address, blockTag: "pending" });
  }

  const txHash = await deps.wallet.anchor(contract, root, batch.leafCount, { nonce, ...feeOverrides });

  await deps.sql`
    update anchor_batches
    set tx_hash = ${Buffer.from(fromHex(txHash))}, tx_nonce = ${nonce}, status = 'submitted', submitted_at = now()
    where id = ${batch.id}
  `;
}

export async function startWorker(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const sql = createDb(config.DATABASE_URL);
  const wallet = createAnchorWalletClient(config);
  const deps: WorkerDeps = { sql, logger, config, wallet };

  logger.info({ intervalMs: config.ANCHOR_INTERVAL_MS }, "anchor worker starting");
  const tick = () => runAnchorTick(deps).catch((err) => logger.error({ err }, "anchor tick failed"));
  await tick();
  setInterval(tick, config.ANCHOR_INTERVAL_MS);
}

// process.argv[1] can be relative (e.g. `tsx src/worker.ts` from the package root) — resolve it to
// a file:// URL the same way Node would, rather than string-matching `file://${argv[1]}` directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWorker();
}
