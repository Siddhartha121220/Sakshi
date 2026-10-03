// Standalone persistent version of test/helpers/test-db.ts's embedded Postgres, for manual
// end-to-end testing (e.g. a real phone hitting a real local server) where a throwaway
// per-test-file DB isn't what you want. Prints DATABASE_URL and stays alive until killed.
import { createTestDb } from "../test/helpers/test-db.js";

const db = await createTestDb();
console.log(`DATABASE_URL=${db.databaseUrl}`);

process.on("SIGINT", async () => {
  await db.close();
  process.exit(0);
});
