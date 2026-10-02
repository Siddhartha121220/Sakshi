// Plain SQL via `postgres` (porsager) — no ORM, per CONTRIBUTING.md. Table shapes are documented in
// docs/DATABASE.md; the migration in db/migrations/ is the source of truth.
import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

export function createDb(databaseUrl: string): Sql {
  return postgres(databaseUrl, {
    // DB columns are snake_case (docs/DATABASE.md); camel-case them at the boundary so the rest
    // of the app reads/writes normal JS field names instead of snake_case everywhere.
    transform: { ...postgres.camel, undefined: null },
  });
}
