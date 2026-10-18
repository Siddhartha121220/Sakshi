# Sakshi — Roadmap

Roughly 8–9 weeks part-time. Each phase ends with something **demoable and tested**. The ordering principle: **de-risk first** (the hardware attestation spike), then build from the trust core outward (protocol → contract → API → verifier → app).

Legend: ☐ todo · ◐ in progress · ☑ done

---

## Phase 0 — Setup and risk spike (week 1)
- ☑ Monorepo: pnpm workspaces, TypeScript strict
- ☐ ESLint + Prettier, `.editorconfig` — deferred to when there's a second app worth sharing a lint config with
- ☐ ~~`docker-compose.yml`~~ — dropped; local dev uses Anvil (via Foundry) and tests spin up an embedded Postgres-compatible DB directly (see `apps/api/test/helpers/test-db.ts`), so there's nothing left for Docker to usefully wrap for a solo project
- ☐ GitHub Actions CI skeleton (lint, typecheck, test; Foundry; Gradle)
- ◐ **Spike (the highest-value thing done so far, now partly done):** rather than a throwaway screen, the real `:app` was installed on a physical phone and its chain captured from a genuine capture.
  - ☑ **1 device: OnePlus CPH2381** (2026-10-03). Chain parses; 4 certs; chains to Google's real Hardware Attestation Root (serial `f92009e853b6b045`); `securityLevel` reported as **TEE**.
  - ☑ Saved as a fixture: `apps/api/test/fixtures/real-attestation-oneplus-cph2381.json`, exercised by `apps/api/test/real-attestation.test.ts` (5 tests) against the **real** Google root list, not an injected fake one.
  - ☑ **It immediately earned its keep.** `attestation.ts` read `attestationApplicationId` from the hardware-enforced list; real Keystore puts it in the *software*-enforced one (the TEE doesn't know what a package name is). Every genuine device would have been rejected with `WRONG_APP`. All 17 synthetic-chain tests passed against that bug, because the synthetic builder shared the wrong assumption — only real hardware could expose it.
  - ☐ **2+ more phones, different OEMs.** One device cannot tell us which of its quirks are universal.
  - ☐ **StrongBox never exercised** — this phone fell back to TEE, so `DeviceKeyManager`'s StrongBox path and the `strongbox` security level remain unrun.
  - ☑ **Live registration with attestation enforced (2026-10-18).** With `DEV_SKIP_ATTESTATION=false` and the debug signing digest allowed, the OnePlus registered through `POST /v1/devices` (201, real 4-cert chain, Google's live revocation list fetched), then a photo went capture → anchor → finalized and verified AUTHENTIC in the browser. No check skipped anywhere.
- **Exit:** ~~CI green on an empty repo~~; partly met — real chains captured and fixtured (1 device, not 3+), and `apps/api/src/attestation.ts` is no longer synthetic-only.

## Phase 1 — Smart contract (week 1–2) ☑ done
- ☑ `SakshiAnchor.sol`: `anchor`, `revokeDevice`, `verify`, `batchCount`, roles
- ☑ Foundry unit tests, fuzz tests (`verify` with random trees), invariant tests (append-only batches, revocation only earlier)
- ☑ Slither: 0 high/medium findings (1 documented false positive)
- ☑ Deploy script, and **deployed to Base Sepolia** on 2026-10-18: `0xf412dE9954A9d8caa35a0B6c1c6E193703765B51` (see packages/contracts/README.md)
- ☐ Gas report: anchor cost vs. leaf count (for the README table)
- **Exit:** met — 100% line/statement/branch/function coverage on `SakshiAnchor.sol`, and live on Base Sepolia.

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
- ☑ Device registration + attestation verification — real Key Attestation parsing/validation (`src/attestation.ts`), tested against synthetic certs **and, since 2026-10-03, against a real captured device chain** (`test/real-attestation.test.ts`), which is what caught the hardware-vs-software-enforced `attestationApplicationId` bug. Enforced live on a real phone on 2026-10-18 — see Phase 0
- ☑ Device request-signature middleware (`src/lib/device-auth.ts`, PROTOCOL §9)
- ☑ Captures: submit, get, by-hash, status, search-similar
- ☑ Time-beacon endpoint
- ☑ Anchor worker: batching, advisory lock, crash recovery, stuck-tx replacement (fee bump, same nonce), finality tracking (with an Anvil-specific fallback — Anvil never rejects `blockTag: 'finalized'`: it reports head minus two epochs, which reads as genesis on a young chain)
- ☑ Integration tests: real local Anvil + an embedded Postgres-compatible DB (no Docker, no real Postgres install needed) — covers the full register → submit → batch → anchor → confirm → finalize → verify path, multi-capture batching, duplicate-image rejection, and on-chain device revocation
- **Exit:** met — `apps/api/scripts/fake-device.ts` submits N captures against a running API and they anchor and verify; exercised directly in the integration tests (27 tests passing) and once manually as separate OS processes (which is how the viem block-number caching bug and a `process.argv[1]` entrypoint bug were actually found — see `apps/api/README.md`'s gotchas section)

## Phase 4 — Web verifier (week 4–5) ☑ mostly done
- ☑ Drag-and-drop page; hashing in a Web Worker so large photos don't freeze the UI
- ☑ Exact path + perceptual path + bundle-file upload
- ☑ "How this was verified" checklist with explorer links
- ☑ Verdict UI for all 6 verdicts (text + icon, accessible) — `describeVerdict` in `VerdictCard.tsx`
- ☐ Deploy to Vercel (pointing at the staging API + Base Sepolia) — not deployed; no staging API or Base Sepolia deployment exists yet (Phase 1's contract is still local/testnet-ready only, not actually deployed)
- **Exit:** not literally met as written (no Base Sepolia deployment to point at) — instead, `apps/web/test/verify-flow.integration.test.ts` runs this app's own `chain-reader.ts` + `api-client.ts` + `verify-flow.ts` against a real local Anvil + API + worker end to end (register → submit → anchor → verify, AUTHENTIC/NO_PROVENANCE/SIMILAR_TO_AUTHENTIC/bundle-file/network-failure paths). Image decoding and the Web Worker wrapper were called real-browser-API glue "with no independent logic" and left for a manual `pnpm dev` check — **that judgement was wrong and cost us**: `image-decode.ts` contained a bug that broke every single upload, and it went unnoticed until a real photo was dropped on the page on 2026-10-03 (see Phase 5). `test/image-decode.test.ts` now covers it in plain Node by faking the two `ImageBitmap`/`OffscreenCanvas` behaviours involved; the Worker plumbing in `hash-worker.ts` is still manual-check only.

## Phase 5 — Android app (week 5–7) ☑ done — verified on a real phone 2026-10-03
- ☑ Kotlin + Compose scaffold; CameraX capture screen
- ☑ Keystore key generation + registration flow — run on a real OnePlus CPH2381: generated a real
  TEE-backed P-256 key and a genuine 4-cert attestation chain (StrongBox unavailable, fell back as
  designed). See Phase 0 for what that run did and didn't prove
- ☑ Kotlin implementation of hashing, pHash, JCS, signing, **passing the shared test vectors** — a
  new `apps/android/protocol` module (pure JVM, no Android dependency), 24/24 tests passing against
  the exact JSON files `packages/core`'s tests use. One confirmed (not hypothetical) floating-point
  edge case on a numerically-degenerate synthetic image — see `CONTRIBUTING.md` invariant #8.
- ☑ Room DB + WorkManager upload queue (offline-first) — ran on device; captures queued and uploaded
- ☑ Time-beacon refresh; status polling — ran on device (status reached `finalized`)
- ☑ Bundle export ("Share proof") — used on device; failures now show a toast instead of being swallowed
- ☑ Sharing the photo: "Send photo" (image, recompressed by WhatsApp → SIMILAR_TO_AUTHENTIC) and
  "Send as zip" (exact bytes → AUTHENTIC; byte-exactness unit-tested in `:app`, WhatsApp delivery of the
  zip itself not yet confirmed); a generic-MIME "send as file" was tried first and observed NOT to work
- ☑ Gallery copy of every new capture (`Pictures/Sakshi`, export only — invariant #5 holds); capture date
  and time shown on each capture
- ☑ Local state persists: Anvil `--state` (block hashes included, so old beacons still verify) and an
  on-disk dev DB; a capture anchored in one run verified AUTHENTIC after a full restart. The app
  re-registers itself on `UNKNOWN_DEVICE` instead of needing a reinstall
- ☑ Server address set in the app (Settings tab, runtime, no rebuild; strict parsing, connection test),
  a proper bottom navigation bar, and a retry action when registration fails. Wireless adb documented
  in `demo.sh` (`--phone SERIAL`), not yet tried on a device; the API answering on the laptop's Wi-Fi
  address was checked
- ☑ Capture list: photo thumbnails (downsampled, EXIF-rotated), a four-step progress track (Signed →
  Uploaded → Anchored → Verified on-chain) with a plain next-step line, pull-to-refresh that syncs
  immediately, and a hint explaining which send button keeps AUTHENTIC. Logic unit-tested; the screens
  themselves not yet looked at on a device
- ☑ Verification links: "Share link" sends `<verifier>/?hash=<sha256>` (hash only, never the photo); the
  verifier preloads that capture's proof and still needs the photo itself. Tested end to end in a
  browser: link → proof preloaded → matching photo → AUTHENTIC; unknown and malformed links handled.
  Link format pinned by matching tests in Kotlin and TypeScript
- ☑ Fixed: on a persisted chain Anvil's "finalized" trails the head by 64 blocks, so photos took 2+
  minutes to finalize; one-slot epochs bring it to ~2 blocks (44 s end to end, measured)
- ☑ App checks its registration at startup (`GET /v1/devices/me`, device-signed) so a server reset is
  caught before a photo is signed under a dead registration — confirmed on the phone: 401 → re-register
- ☑ Fixed: a reloaded Anvil resumes from its last saved block timestamp, leaving the chain clock behind
  real time by the downtime (20 min observed), so the proven time window was wrong. `demo.sh` now
  jumps the next block to now on start
- ☑ `scripts/demo.sh` — one command for the whole local demo (chain, deploy, DB, API + worker, web, phone
  over USB via `adb reverse`, so phone and laptop needn't share a network)
- ☑ Opt-in location — written, not yet run
- **Exit: MET (local chain).** On 2026-10-03 a photo was taken in the app on a physical OnePlus
  CPH2381, signed with a real TEE-backed Keystore key, uploaded, Merkle-batched, anchored and
  finalized on a local Anvil chain, and then verified as **AUTHENTIC** in a browser by the web
  verifier reading the chain directly. Caveats worth keeping in view: local Anvil rather than Base
  Sepolia, and `DEV_SKIP_ATTESTATION=true` during registration (Phase 0).
- **Three real bugs surfaced by this first real run**, none of which any existing test caught:
  - `apps/web/src/lib/image-decode.ts` closed the `ImageBitmap` before reading its dimensions. A
    closed bitmap reports 0×0, so `getImageData` threw "The source width is 0" on **every** photo —
    the web verifier could never have verified anything. Fixed; regression test added.
  - The API registered no CORS at all, so a browser on another origin could never call it. Every
    Node-side test passed because `fetch` in Node doesn't enforce CORS. Fixed; regression test added.
  - The attestation `attestationApplicationId` bug — see Phase 0.
- **Still unverified on device:** the Compose UI beyond the capture and list screens, the share
  sheet, opt-in location, StrongBox, and anything on a second device or OEM.

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
