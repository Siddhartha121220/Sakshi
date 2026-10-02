# Contributing to Sakshi

Sakshi: capture-time photo provenance. An Android app signs photo fingerprints with hardware-backed keys, a backend Merkle-batches them onto Base L2, and a static web verifier checks everything client-side.

## Read before changing things
- `docs/PROTOCOL.md` — **normative** wire formats, hashing, verification. Any change to manifests, hashing, Merkle leaves, pHash, or verification MUST update this file in the same change.
- `docs/ARCHITECTURE.md` — components, flows, key decisions (D1–D11). Don't silently reverse a decision; propose it first.
- `docs/THREAT_MODEL.md` — check that security-relevant changes don't break a mitigation.
- `docs/ROADMAP.md` — current phase. Mark items ☑ when done.

## Layout
```
apps/android        Kotlin, Compose, CameraX, Keystore (Gradle)
apps/api            Fastify API + anchor worker (src/worker.ts); db/migrations = schema source of truth
apps/web            React + Vite static verifier
packages/contracts  Foundry: SakshiAnchor.sol
packages/core       Shared TS: protocol, pHash, merkle, verify(); test-vectors/ shared with Kotlin
```

## Commands
> Filled in as each phase lands. Keep this list accurate.
```bash
pnpm install                         # all TS workspaces
docker compose up -d                 # postgres, minio, anvil
pnpm -r test                         # all TS tests
pnpm -r typecheck && pnpm -r lint
pnpm --filter api db:migrate         # dbmate up
pnpm --filter api dev                # API
pnpm --filter api worker             # anchor worker
pnpm --filter web dev                # verifier
cd packages/contracts && forge test -vvv && forge coverage
cd apps/android && ./gradlew test
```

## Non-negotiable invariants
1. **Signed bytes are sacred.** Store and transmit `manifest_bytes` verbatim. Never re-serialise a signed manifest, and never store it only as `jsonb`.
2. **P-256, not secp256k1.** Android Keystore can't do secp256k1. Signatures are DER on the wire; convert to raw r‖s only for WebCrypto.
3. **No floats in manifests.** Coordinates are strings; integers < 2^53.
4. **Photos never go on-chain and never reach the server** unless the user explicitly publishes them.
5. **No gallery import** in the Android app, anywhere. Signing happens only in the capture callback.
6. **The verifier trusts the chain, not our API.** The web app reads roots, revocations, and block hashes from its own RPC. The API only delivers bundles.
7. **The perceptual path never returns `AUTHENTIC`.** Only `SIMILAR_TO_AUTHENTIC`.
8. **Kotlin and TS must agree byte-for-byte.** Any hashing or encoding change needs updated vectors in `packages/core/test-vectors/`, passing on both sides.
9. **The contract is non-upgradeable and append-only.** No proxies, no functions that edit or delete batches.
10. **Capture status is derived** (`batch_id IS NULL` = pending). Don't add a status column to `captures`.

## Conventions
- TypeScript strict, ESM, no `any` without a comment explaining why. Validate every external input with zod at the boundary.
- SQL: plain SQL via `postgres` (porsager). No ORM. Schema changes = a new dbmate migration file; never edit an applied migration.
- Hashes are `bytea` in the DB, lowercase hex without `0x` in JSON, and `0x`-hex for EVM values (block/tx hashes, roots, proofs).
- Errors from the API: `{ error: { code, message } }` with codes listed in `docs/API.md`.
- Solidity: OpenZeppelin primitives, custom errors (not revert strings), events for every state change, NatSpec on public functions.
- Kotlin: coroutines, no blocking I/O on the main thread; Keystore calls off the main thread (StrongBox signing can take ~200 ms).
- Keep dependencies minimal. Before adding one, check whether the stdlib, the platform, or an existing dependency covers it. Note new deps in the PR description.
- Comments explain *why*, not *what*. Match the surrounding code's density.

## Testing expectations
- Contracts: unit + fuzz + invariant tests; Slither clean.
- `packages/core`: every verdict path has a positive and a negative test vector.
- API: integration tests against real Postgres + Anvil (docker compose), not mocks of the DB.
- Every bug fix gets a regression test.

## Security
- Never commit secrets. `.env.example` lists variable names only.
- The dev-only attestation bypass (for the fake-device script) MUST refuse to start when `NODE_ENV=production`.
- Don't log manifests that contain location, signatures, or request bodies at info level.

## Environments
local = Anvil (31337) · staging/pilot = Base Sepolia (84532) · prod = Base (8453)
