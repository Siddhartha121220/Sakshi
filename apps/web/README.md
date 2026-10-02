# @sakshi/web

The public verifier (docs/ROADMAP.md Phase 4): drop in a photo, get back an answer — Authentic,
Similar to an authentic photo, Device revoked, Invalid, or No provenance — with every check run
**in your browser**, never trusted to the Sakshi server. See docs/ARCHITECTURE.md §2.5 and §4.

## Setup
```bash
cp .env.example .env.local   # point at a running API + chain (see apps/api/README.md to run one locally)
pnpm --filter web dev
```

## How it's structured
- `src/lib/hash-worker.ts` + `hash-client.ts` — hashing (SHA-256, perceptual hash) runs in a Web
  Worker, so a large photo never freezes the UI (docs/ROADMAP.md Phase 4).
- `src/lib/image-decode.ts` — decodes a `File` to RGB pixels for `@sakshi/core`'s pHash functions.
  Thin, deliberately untested browser glue (`createImageBitmap`/`OffscreenCanvas`) — see **Testing**.
- `src/lib/chain-reader.ts` — implements `@sakshi/core`'s `ChainReader` via viem, reading straight
  from the configured RPC. This is what the app actually trusts; `api-client.ts` never is.
- `src/lib/verify-flow.ts` — the orchestration logic for docs/PROTOCOL.md §8 (exact match) and §8.1
  (perceptual fallback). Deliberately decoupled from the DOM and from image decoding — it takes
  already-computed hashes and bytes — so it's unit-testable in plain Node.
- `src/components/` — `Dropzone`, `VerdictCard` (the verdict → icon/title/text mapping is exported
  as `describeVerdict` for unit testing without a rendering library), `HowVerified`.

## Testing
```bash
pnpm --filter web test
```
No DOM, no Playwright, no `@testing-library/react` — and deliberately so:
- `verify-flow.ts`, `explorer.ts`, and `describeVerdict` are plain functions, tested as such.
- `test/verify-flow.integration.test.ts` reuses `apps/api`'s test infrastructure (a real local
  Anvil + an embedded Postgres-compatible DB — see `apps/api/README.md`) to run this app's own
  `chain-reader.ts` + `api-client.ts` + `verify-flow.ts` against a real running API, worker, and
  chain: register a device, submit and anchor a capture, then verify it through this app's code.
  This is what stands in for "a photo verifies end to end in the browser" until a real
  Playwright/E2E pass is worth adding — the only pieces it does *not* exercise are image decoding
  and the Worker wrapper (real browser APIs with no meaningful logic to unit test), left as manual
  checks via `pnpm dev`.

## Deploying
Static build, no server component:
```bash
pnpm --filter web build   # outputs apps/web/dist/
```
Point `VITE_API_BASE_URL` at a deployed API and `VITE_RPC_URL`/`VITE_CHAIN_ID`/
`VITE_SAKSHI_ANCHOR_CONTRACT` at a public RPC (e.g. Base Sepolia) before building for production —
these are baked in at build time, not read at runtime.
