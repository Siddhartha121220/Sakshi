# @sakshi/api

The REST API ([docs/API.md](../../docs/API.md)) and anchor worker ([docs/ARCHITECTURE.md §3.3](../../docs/ARCHITECTURE.md)) — device registration with real Android Key Attestation, capture submission/lookup, and the background job that Merkle-batches captures onto SakshiAnchor.

## Setup
```bash
cp .env.example .env   # fill in DATABASE_URL, CHAIN_ID, RPC_URL, SAKSHI_ANCHOR_CONTRACT, SERVER_CHALLENGE_SECRET
pnpm --filter api db:migrate   # dbmate up — needs a real Postgres at DATABASE_URL
```
Tests don't need any of this — see **Testing** below.

## Commands
```bash
pnpm --filter api test          # vitest — spins up real Anvil + an embedded Postgres per file
pnpm --filter api typecheck
BASE_URL=http://localhost:3000 COUNT=1000 pnpm --filter api fake-device   # load-test script
```

Running it locally against the embedded dev DB (e.g. for a real phone):
```bash
pnpm --filter api dev:db        # embedded Postgres; prints the DATABASE_URL to put in .env
pnpm --filter api dev:all       # API :3000 + anchor worker, ONE process, one DB connection
```
**Use `dev:all`, not `dev` + `worker`.** Those two are separate processes and therefore separate
DB connections, which the embedded dev DB can't serve (see the known limitation under Testing);
the symptom is a confusing `read ECONNRESET` from postgres.js on whichever one connected first,
not an error that mentions connection limits. Against real Postgres, run them separately as
intended — that's what `src/server.ts` and `src/worker.ts` are for, and what production does.

## Testing
No Docker, no local Postgres install required:
- **Chain**: `test/helpers/anvil.ts` spawns a real local Anvil per test file and deploys `SakshiAnchor` from the Foundry build artifact (`packages/contracts/out/`) via viem — run `forge build` there first if it's missing.
- **Database**: `test/helpers/test-db.ts` runs an embedded PGlite instance with [`@electric-sql/pglite-socket`](https://github.com/electric-sql/pglite) bridging it to a real TCP socket, so the production `postgres` client talks to it unmodified. The migration SQL is applied directly (dbmate itself doesn't get along with this socket bridge — dbmate remains the real tool for actual deployments).
  - **Known limitation**: this embedded DB serves one connection well, not several truly concurrent ones or multiple OS processes — fine for a single test file's sequential-ish load, but don't write a test that fires concurrent writes at it (see comments in `test/integration.test.ts`) or run the server and worker as separate processes against it. Real Postgres has neither limitation.
- **Device**: `test/helpers/fake-device.ts` is a software device (real P-256 key, no real attestation) that talks to the real HTTP API — used by both the integration tests and `scripts/fake-device.ts`'s manual load test. It relies on `DEV_SKIP_ATTESTATION=true`, which the server refuses to honour when `NODE_ENV=production`.
- **Attestation**: `test/helpers/synthetic-attestation.ts` builds a real (but self-signed, non-Google) 2-certificate chain with a genuine `KeyDescription` X.509 extension, so `attestation.ts`'s parsing and validation logic (docs/PROTOCOL.md §2.3, checks A1-A8) is exercised against real ASN.1 bytes rather than mocks. It does **not** replace testing against a real device — see docs/ROADMAP.md Phase 0.

## Gotchas hit while building this (left here so they don't get rediscovered)
- **Real devices put `attestationApplicationId` in the SOFTWARE-enforced list, not the hardware-enforced one.** The TEE has no concept of an Android package name, so Keystore fills this in. Reading only `hardwareEnforced` made `verifyAndroidAttestation` return `WRONG_APP` for *every* genuine phone — and all 17 synthetic-chain tests passed anyway, because the synthetic builder encoded the same wrong assumption. Found only by running a captured real chain through it (`test/real-attestation.test.ts`). `rootOfTrust`, by contrast, genuinely *is* hardware-enforced.
- **The API had no CORS**, so the browser verifier on another origin could never call it, while every Node-side test passed — `fetch` in Node doesn't enforce CORS. `@fastify/cors` is registered in `app.ts`; the regression test is in `test/integration.test.ts`.
- **viem caches `getBlockNumber()`** for a few seconds by default. The anchor worker's finality check calls it every tick — pass `cacheTime: 0` (see `src/chain.ts`) or it'll think the chain stalled.
- **Anvil doesn't reject `blockTag: 'finalized'`** — it silently always returns genesis. Don't rely on the RPC call throwing to detect "this chain has no real finality"; `worker.ts`'s `pollFinality` checks for a genesis-while-the-chain-has-moved-on result instead.
- **`@peculiar/asn1-schema` deserialises some OCTET STRING fields as a bare `ArrayBuffer` instead of the `OctetString` wrapper**, inconsistently by nesting depth (confirmed empirically, not documented anywhere obvious) — `attestation.ts`'s `octetBytes()` helper handles both shapes.
- **postgres.js needs `sql.array(...)`** for an explicit array parameter (e.g. an empty `bytea[]` proof for a single-leaf batch) — passing a plain JS array directly can misinfer the element type.
- **A custom Fastify `process.argv[1]` self-invoke check** (`if (import.meta.url === ...)`) must resolve `argv[1]` through `pathToFileURL`, not string-concatenate `file://` onto it — `argv[1]` can be relative (e.g. running via `tsx src/worker.ts` from the package root).
