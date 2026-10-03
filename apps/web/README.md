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
- `src/lib/image-decode.ts` — decodes a `File` to RGB pixels for `@sakshi/core`'s pHash functions
  (`createImageBitmap`/`OffscreenCanvas`). Thin, but not logic-free — see **Gotchas**.
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
  Playwright/E2E pass is worth adding.
- `test/image-decode.test.ts` — `image-decode.ts` was previously dismissed as browser glue "with no
  meaningful logic to unit test" and left to manual checks. It contained a bug that failed **every**
  upload (details under Gotchas), which no amount of the integration test above would have caught,
  because that test never decodes an image. It's now tested in plain Node against hand-written
  `createImageBitmap`/`OffscreenCanvas` fakes that model the two spec behaviours involved. The
  Worker wrapper in `hash-worker.ts` remains a manual `pnpm dev` check.

## Gotchas hit while building this (left here so they don't get rediscovered)
- **A closed `ImageBitmap` reports `width`/`height` as 0.** `image-decode.ts` called
  `bitmap.close()` and then read `bitmap.width` for `getImageData`, so every photo failed with
  "Failed to execute 'getImageData' ... The source width is 0". Read the dimensions into locals
  *before* closing. This shipped because the module was treated as untestable glue; it is now
  covered by `test/image-decode.test.ts`.
- **The API needs CORS and didn't have it.** This app is a static site on its own origin, so every
  call to the API is cross-origin; `fetch` in Node (where the API's own tests run) doesn't enforce
  CORS, so nothing caught it until a browser tried. Fixed in `apps/api/src/app.ts`.
- **Missing `.env.local` renders a blank page**, because `src/lib/config.ts` throws at import time
  and nothing is left to mount an error boundary. The thrown message names the missing variable —
  check the Vite dev-server console, not just the page.
- **Phone camera EXIF can be malformed.** The OnePlus CPH2381 used for the first real-device run
  writes `ExifImageWidth`/`Height` of 0 and an orientation of 0 (the spec allows 1-8). Decoders
  that trust those tags could return an empty bitmap, so `image-decode.ts` keeps a fallback to an
  unoriented decode. That fallback is defensive — it has not been observed to fire.

## Deploying
Static build, no server component:
```bash
pnpm --filter web build   # outputs apps/web/dist/
```
Point `VITE_API_BASE_URL` at a deployed API and `VITE_RPC_URL`/`VITE_CHAIN_ID`/
`VITE_SAKSHI_ANCHOR_CONTRACT` at a public RPC (e.g. Base Sepolia) before building for production —
these are baked in at build time, not read at runtime.
