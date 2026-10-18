// The API and the anchor worker in ONE process on one shared `sql` connection pool. Used where a second
// process isn't available or wanted:
//  - locally, because the embedded PGlite dev DB (scripts/dev-db.ts) can't serve two separately
//    connecting processes;
//  - on hosts whose free tier has no background workers (e.g. Render). There the worker only runs
//    while the web service is awake; captures queued while it sleeps get anchored on the next wake.
// With real Postgres and room for two processes, src/server.ts + src/worker.ts separately is equivalent;
// the worker's advisory lock keeps it to one anchoring instance either way.
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createDb } from "./db.js";
import { createViemPublicClient, createChainReader, createAnchorWalletClient } from "./chain.js";
import { buildApp } from "./app.js";
import { runAnchorTick } from "./worker.js";

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
