import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createDb } from "./db.js";
import { createViemPublicClient, createChainReader } from "./chain.js";
import { buildApp } from "./app.js";

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

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await sql.end();
    process.exit(0);
  });
}
