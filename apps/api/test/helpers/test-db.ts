// An embedded Postgres-compatible DB for integration tests, so they don't need a real Postgres
// install. PGlite runs Postgres in WASM in-process; pglite-socket exposes it over a real TCP
// socket speaking the wire protocol, so the actual `postgres` (porsager) client — the same one
// production uses — talks to it unmodified. (dbmate itself doesn't get along with this socket
// bridge, so here we apply the migration SQL directly instead; dbmate remains the documented tool
// for real deployments — see apps/api/package.json's db:migrate.)
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export interface TestDb {
  databaseUrl: string;
  close(): Promise<void>;
}

export interface TestDbOptions {
  /** Persist to this directory instead of memory (scripts/dev-db.ts). Tests leave it unset. */
  dataDir?: string;
  /** Listen on a fixed port instead of a random free one. */
  port?: number;
}

export async function createTestDb(opts: TestDbOptions = {}): Promise<TestDb> {
  const migrationPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "db",
    "migrations",
    "20261002000000_init.sql",
  );
  const fullSql = readFileSync(migrationPath, "utf8");
  const upSql = fullSql.split("-- migrate:down")[0]!.replace("-- migrate:up", "");

  const db = new PGlite(opts.dataDir);
  // A persisted DB already has the schema; re-running the migration would fail on CREATE TABLE.
  const existing = await db.query<{ t: string | null }>("select to_regclass('public.devices')::text as t");
  if (!existing.rows[0]?.t) await db.exec(upSql);

  const port = opts.port ?? (await getFreePort());
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();

  return {
    databaseUrl: `postgres://postgres@127.0.0.1:${port}/postgres?sslmode=disable`,
    async close() {
      await server.stop();
      await db.close();
    },
  };
}
