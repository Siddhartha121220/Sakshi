# Sakshi — Roadmap

Roughly 8–9 weeks part-time. Each phase ends with something **demoable and tested**. The ordering principle: **de-risk first** (the hardware attestation spike), then build from the trust core outward (protocol → contract → API → verifier → app).

Legend: ☐ todo · ◐ in progress · ☑ done

---

## Phase 0 — Setup and risk spike (week 1)
- ☑ Monorepo: pnpm workspaces, TypeScript strict
- ☐ ESLint + Prettier, `.editorconfig` — deferred to when there's a second app worth sharing a lint config with
- ☐ ~~`docker-compose.yml`~~ — dropped; local dev uses Anvil (via Foundry) and tests spin up an embedded Postgres-compatible DB directly (see `apps/api/test/helpers/test-db.ts`), so there's nothing left for Docker to usefully wrap for a solo project
- ☐ GitHub Actions CI skeleton (lint, typecheck, test; Foundry; Gradle)
- ☐ **Spike (most important, still outstanding):** a throwaway Android screen that generates an attested P-256 key and dumps the cert chain. Test on **3+ real phones** (different OEMs). Confirm the chain parses and StrongBox/TEE levels are reported
- **Exit:** ~~CI green on an empty repo~~; attestation chains captured from real devices and saved as test fixtures — **not yet done; `apps/api/src/attestation.ts` is only tested against synthetic certs so far (`apps/api/test/helpers/synthetic-attestation.ts`)**

## Phase 1 — Smart contract (week 1–2) ☑ done
- ☑ `SakshiAnchor.sol`: `anchor`, `revokeDevice`, `verify`, `batchCount`, roles
- ☑ Foundry unit tests, fuzz tests (`verify` with random trees), invariant tests (append-only batches, revocation only earlier)
- ☑ Slither: 0 high/medium findings (1 documented false positive)
- ☑ Deploy script (local/testnet) — not yet actually deployed to Base Sepolia
- ☐ Gas report: anchor cost vs. leaf count (for the README table)
- **Exit:** 100% line/statement/branch/function coverage on `SakshiAnchor.sol`. Not yet live on Base Sepolia.

## Phase 2 — Core protocol library `packages/core` (week 2–3) ☑ done
- ☑ Manifest types + zod schema; JCS canonicalisation
- ☑ DER ↔ raw signature conversion; P-256 verify (WebCrypto, works in Node and browser)
- ☑ pHash + tile hashes per PROTOCOL §5 (box filter, DCT, EXIF orientation)
- ☑ Merkle helpers on `@openzeppelin/merkle-tree`
- ☑ `verifyBundle(file, bundle, chainReader)` → verdict, implementing PROTOCOL §8 (steps 1-13; step 6's attestation-chain check is P2)
- ☑ **Test vectors** (`test-vectors/*.json`): JCS, DER⟷raw signature encoding, pHash of synthetic images, a Merkle tree — self-verified at generation time
- **Exit:** met — 67 tests passing

## Phase 3 — API, database, and anchor worker (week 3–4) ☑ done
- ☑ Fastify app, config via env (zod-validated), structured logging (pino)
- ☑ dbmate wired as the documented migration tool (`pnpm db:migrate`); tests apply the same SQL directly against an embedded DB instead (dbmate doesn't get along with that bridge — see `apps/api/README.md`)
- ☑ Device registration + attestation verification — real Key Attestation parsing/validation (`src/attestation.ts`), tested against synthetic certs; **still needs the real-device fixtures from Phase 0's outstanding spike**
- ☑ Device request-signature middleware (`src/lib/device-auth.ts`, PROTOCOL §9)
- ☑ Captures: submit, get, by-hash, status, search-similar
- ☑ Time-beacon endpoint
- ☑ Anchor worker: batching, advisory lock, crash recovery, stuck-tx replacement (fee bump, same nonce), finality tracking (with an Anvil-specific fallback — Anvil never rejects `blockTag: 'finalized'`, it just always returns genesis)
- ☑ Integration tests: real local Anvil + an embedded Postgres-compatible DB (no Docker, no real Postgres install needed) — covers the full register → submit → batch → anchor → confirm → finalize → verify path, multi-capture batching, duplicate-image rejection, and on-chain device revocation
- **Exit:** met — `apps/api/scripts/fake-device.ts` submits N captures against a running API and they anchor and verify; exercised directly in the integration tests (27 tests passing) and once manually as separate OS processes (which is how the viem block-number caching bug and a `process.argv[1]` entrypoint bug were actually found — see `apps/api/README.md`'s gotchas section)

## Phase 4 — Web verifier (week 4–5) ☑ mostly done
- ☑ Drag-and-drop page; hashing in a Web Worker so large photos don't freeze the UI
- ☑ Exact path + perceptual path + bundle-file upload
- ☑ "How this was verified" checklist with explorer links
- ☑ Verdict UI for all 6 verdicts (text + icon, accessible) — `describeVerdict` in `VerdictCard.tsx`
- ☐ Deploy to Vercel (pointing at the staging API + Base Sepolia) — not deployed; no staging API or Base Sepolia deployment exists yet (Phase 1's contract is still local/testnet-ready only, not actually deployed)
- **Exit:** not literally met as written (no Base Sepolia deployment to point at) — instead, `apps/web/test/verify-flow.integration.test.ts` runs this app's own `chain-reader.ts` + `api-client.ts` + `verify-flow.ts` against a real local Anvil + API + worker end to end (register → submit → anchor → verify, AUTHENTIC/NO_PROVENANCE/SIMILAR_TO_AUTHENTIC/bundle-file/network-failure paths). Image decoding and the Web Worker wrapper are real-browser-API glue with no independent logic, left for a manual `pnpm dev` check rather than E2E/Playwright (see apps/web/README.md).

## Phase 5 — Android app (week 5–7)
- ☐ Kotlin + Compose scaffold; CameraX capture screen
- ☐ Keystore key generation + registration flow (reusing the Phase 0 spike)
- ☐ Kotlin implementation of hashing, pHash, JCS, signing, **passing the shared test vectors**
- ☐ Room DB + WorkManager upload queue (offline-first)
- ☐ Time-beacon refresh; status polling; bundle export; "share as file"
- ☐ Opt-in location
- **Exit:** a real photo taken on a real phone shows ✅ on the website; a WhatsApp-forwarded copy shows 🟦 *similar*

## Phase 6 — Albums and publishing (week 7–8)
- ☐ API + app: albums, share links, publish/unpublish originals (MinIO/R2)
- ☐ Web: album page, capture page, side-by-side + tile-diff heatmap
- **Exit:** "Room 204 — move-in" album shared via link, opened on a laptop, all photos verified

## Phase 7 — Pilot and polish (week 8–9)
- ☐ **Calibrate pHash thresholds**: 200+ images × (WhatsApp, Instagram, resize, JPEG q50) vs. distinct images vs. local edits. Publish precision/recall in the README
- ☐ Hostel pilot with ≥ 50 students; collect metrics from `verification_events`
- ☐ README: demo GIF, architecture diagram, gas/cost table, calibration results, pilot numbers
- ☐ Security pass: re-run Slither, dependency audit, check THREAT_MODEL against the implementation
- **Exit:** the numbers for the resume bullets are real and measured

---

## P2 backlog (after v1)
- In-browser verification of the attestation chain (removes trust in the server's `securityLevel`)
- Screen re-photography detection (moiré, depth)
- C2PA manifest export for interop with Adobe/Google tooling
- Crop-robust matching
- Multi-index hashing for similarity search at scale
- Account recovery across phones
- iOS (App Attest + Secure Enclave)
- On-chain consumer example: a toy "insurance payout" contract that calls `verify()`
