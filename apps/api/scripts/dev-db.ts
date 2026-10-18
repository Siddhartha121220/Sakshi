// The embedded Postgres from test/helpers/test-db.ts, run standalone for manual end-to-end testing
// (e.g. a real phone against a real local server). Unlike the tests' throwaway DB it is PERSISTED to
// disk and listens on a FIXED port, so registrations and captures survive restarts and DATABASE_URL
// never changes. Delete the data directory (or run scripts/demo.sh --reset) for a clean slate.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb } from "../test/helpers/test-db.js";

const dataDir = resolve(process.env.SAKSHI_DEV_DB_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".devdb"));
const port = Number(process.env.SAKSHI_DEV_DB_PORT ?? 54329);
mkdirSync(dataDir, { recursive: true });

const db = await createTestDb({ dataDir, port });
console.log(`DATABASE_URL=${db.databaseUrl}`);
console.log(`(data persisted in ${dataDir})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await db.close(); // flushes PGlite's files; killing it mid-write is what corrupts a data dir
    process.exit(0);
  });
}
