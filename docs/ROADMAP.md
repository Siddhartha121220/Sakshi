# Sakshi — Roadmap

Roughly 8–9 weeks part-time. Each phase ends with something **demoable and tested**. The ordering principle: **de-risk first** (the hardware attestation spike), then build from the trust core outward (protocol → contract → API → verifier → app).

Legend: ☐ todo · ◐ in progress · ☑ done

---

## Phase 0 — Setup and risk spike (week 1)
- ☐ Monorepo: pnpm workspaces, TypeScript strict, ESLint + Prettier, `.editorconfig`
- ☐ `docker-compose.yml`: postgres:16, minio, anvil
- ☐ GitHub Actions CI skeleton (lint, typecheck, test; Foundry; Gradle)
- ☐ **Spike (most important):** a throwaway Android screen that generates an attested P-256 key and dumps the cert chain. Test on **3+ real phones** (different OEMs). Confirm the chain parses and StrongBox/TEE levels are reported
- **Exit:** CI green on an empty repo; attestation chains captured from real devices and saved as test fixtures

## Phase 1 — Smart contract (week 1–2)
- ☐ `SakshiAnchor.sol`: `anchor`, `revokeDevice`, `verify`, `batchCount`, roles
- ☐ Foundry unit tests, fuzz tests (`verify` with random trees), invariant tests (append-only batches, revocation only earlier)
- ☐ Slither in CI with zero high/medium findings
- ☐ Deploy script; deploy to Base Sepolia; verify on Basescan
- ☐ Gas report: anchor cost vs. leaf count (for the README table)
- **Exit:** contract live on Base Sepolia, verified, 100% line coverage

## Phase 2 — Core protocol library `packages/core` (week 2–3)
- ☐ Manifest types + zod schema; JCS canonicalisation
- ☐ DER ↔ raw signature conversion; P-256 verify (WebCrypto, works in Node and browser)
- ☐ pHash + tile hashes per PROTOCOL §5 (box filter, DCT, EXIF orientation)
- ☐ Merkle helpers on `@openzeppelin/merkle-tree`
- ☐ `verify(file, bundle, rpc)` → verdict, implementing PROTOCOL §8 completely
- ☐ **Test vectors** (`test-vectors/*.json`): manifests, signatures, pHash inputs/outputs, Merkle trees, plus tampered negatives
- **Exit:** `verify()` passes all positive and negative vectors

## Phase 3 — API, database, and anchor worker (week 3–4)
- ☐ Fastify app, config via env (zod-validated), structured logging (pino)
- ☐ dbmate migrations wired into `pnpm db:migrate`
- ☐ Device registration + attestation verification (using Phase 0 fixtures)
- ☐ Device request-signature middleware
- ☐ Captures: submit, get, by-hash, status, search-similar
- ☐ Time-beacon endpoint
- ☐ Anchor worker: batching, advisory lock, crash recovery, stuck-tx replacement, finality tracking
- ☐ Integration tests against docker-compose Postgres + Anvil (incl. kill-the-worker-mid-batch test)
- **Exit:** a scripted "fake device" (Node, software P-256 key, dev-only attestation bypass flag) submits 1,000 captures, and they're anchored on Anvil and verifiable

## Phase 4 — Web verifier (week 4–5)
- ☐ Drag-and-drop page; hashing in a Web Worker so large photos don't freeze the UI
- ☐ Exact path + perceptual path + bundle-file upload
- ☐ "How this was verified" checklist with explorer links
- ☐ Verdict UI for all 6 verdicts (text + icon, accessible)
- ☐ Deploy to Vercel (pointing at the staging API + Base Sepolia)
- **Exit:** a photo from the Phase 3 fake device verifies end-to-end in the browser against Base Sepolia

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
