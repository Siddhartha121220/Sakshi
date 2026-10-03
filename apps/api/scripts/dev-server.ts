// Dev-only: runs the API and the anchor worker in one process on one shared `sql` connection.
// In production they're separate processes (src/server.ts / src/worker.ts) against real Postgres,
// which handles concurrent connections fine — this only exists because the embedded PGlite dev DB
// (scripts/dev-db.ts) can't reliably serve two independently-connecting processes at once.
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { createDb } from "../src/db.js";
import { createViemPublicClient, createChainReader, createAnchorWalletClient } from "../src/chain.js";
import { buildApp } from "../src/app.js";
import { runAnchorTick } from "../src/worker.js";

const config = loadConfig();
const logger = createLogger(config);
const sql = createDb(config.DATABASE_URL);
const publicClient = createViemPublicClient(config);
const chainReader = createChainReader(publicClient);

const app = buildApp({ config, sql, logger, chainReader, publicClient });

app
  .listen({ port: config.PORT, host: "0.0.0.0" })
  .then((address) => logger.info({ address }, "sakshi api listening"))
  .catch((err) => {
    logger.error({ err }, "failed to start");
    process.exit(1);
  });

if (config.ANCHORER_PRIVATE_KEY) {
  const wallet = createAnchorWalletClient(config);
  const workerDeps = { sql, logger, config, wallet };
  logger.info({ intervalMs: config.ANCHOR_INTERVAL_MS }, "anchor worker starting (in-process)");
  setInterval(() => {
    runAnchorTick(workerDeps).catch((err) => logger.error({ err }, "anchor tick failed"));
  }, config.ANCHOR_INTERVAL_MS);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await sql.end();
    process.exit(0);
  });
}
