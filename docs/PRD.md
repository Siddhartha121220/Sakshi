# Sakshi — Product Requirements Document

| | |
|---|---|
| **Status** | Draft v1 — design phase |
| **Owner** | Siddhartha |
| **Last updated** | 2026-10-02 |

> *Sakshi* (साक्षी) is Sanskrit for **witness**. A Sakshi photo is a witness that cannot be bribed: it proves *what* was captured, *by a genuine camera*, and *when*.

---

## 1. Problem

Generative AI can produce photorealistic images in seconds. This breaks trust in photos in two ways:

1. **Fakes pass as real.** Edited or generated images are used for fraud (insurance claims, refunds, deposit disputes) and misinformation.
2. **Real photos get dismissed as fake** (the *liar's dividend*). Genuine evidence loses value because anyone can say "that's AI".

Detecting fakes is a losing arms race, because every new generator beats yesterday's detector. Sakshi takes the opposite approach: **prove real photos are real, at the moment of capture.**

### 1.1 Wedge use case: hostel and rental condition evidence

Students and tenants routinely lose deposits over disputes such as "that crack was already there" or "no, you caused it". Today it's one person's word against another's, and ordinary photos can be backdated or edited.

With Sakshi, a tenant photographs the room at move-in. Each photo is signed by the phone's security hardware and timestamped on a public blockchain. At move-out, the tenant or warden shares a link, and anyone can check that the photos are unedited and were taken on the stated date.

We start here because it's a real, recurring pain, and we can pilot it with our own hostel batch.

### 1.2 Later use cases (not v1)
Insurance claims, delivery and return proof, citizen journalism, and legal evidence.

---

## 2. Goals and non-goals

### Goals (v1)
- G1. Capture photos whose **content, device authenticity, and time window** are independently verifiable by anyone.
- G2. Verification needs **no trust in the Sakshi server**. Given a photo and its proof bundle, a verifier checks everything against public cryptography and a public chain.
- G3. Verification **still works after messaging apps strip metadata or recompress** the photo (WhatsApp, Instagram), via perceptual matching.
- G4. **Privacy by default.** Photos stay on the device unless the user explicitly publishes them; only hashes ever reach the blockchain.
- G5. Cost per photo is negligible (target < $0.0001) through Merkle batching on an L2.
- G6. A successful **pilot**: real students using it for room move-in and move-out.

### Non-goals (v1)
- Detecting whether an arbitrary internet photo is AI-generated.
- iOS app, video, or audio.
- Tracking provenance through edits (C2PA-style edit chains) — P2.
- Detecting re-photographs of screens or prints (the "analog hole") — P2, documented as a known limitation.
- Tokens, NFTs, or any user-facing cryptocurrency. Users never see a wallet or pay gas.

---

## 3. Personas

| Persona | Description | Needs |
|---|---|---|
| **Tenant / student** (primary) | Moving into a hostel room or rented flat | Fast capture, proof they can share later, no crypto knowledge |
| **Warden / landlord** | Receives evidence during disputes | Opens a link and sees a clear ✅/❌ without installing anything |
| **Public verifier** | Journalist, insurer, curious person | Drops in any photo and learns whether it has provenance |
| **Operator** (us) | Runs the API and anchoring service | Low cost, observability, ability to revoke compromised devices |

---

## 4. User stories

| ID | As a… | I want to… | So that… | Priority |
|---|---|---|---|---|
| US-1 | Tenant | open the app and take photos as quickly as a normal camera | capturing evidence isn't a chore | P0 |
| US-2 | Tenant | see each photo marked *Signed*, then *Anchored* | I know the proof is secured | P0 |
| US-3 | Tenant | group photos into an album ("Room 204 — move-in") | I can present them together | P1 |
| US-4 | Tenant | share an album or photo link | the warden can verify without the app | P1 |
| US-5 | Tenant | export a proof bundle file | my proof survives even if Sakshi shuts down | P0 |
| US-6 | Verifier | drag a photo onto the website and get a verdict | I can trust or reject it in seconds | P0 |
| US-7 | Verifier | verify a WhatsApp-forwarded copy | stripped metadata doesn't break verification | P0 |
| US-8 | Verifier | see *which regions* differ from the original | I can spot local edits (e.g. an added dent) | P1 |
| US-9 | Verifier | see the proven time window, not just the phone's clock | I know the photo can't be backdated | P0 |
| US-10 | Operator | revoke a compromised device key on-chain | its future signatures are distrusted publicly | P0 |
| US-11 | Tenant | opt in to attaching coarse location | the evidence shows *where*, only if I choose | P1 |

---

## 5. Functional requirements

### 5.1 Mobile app (Android)

| ID | Requirement | Priority |
|---|---|---|
| FR-M1 | On first launch, generate an EC P-256 signing key in Android Keystore (StrongBox if available, else TEE) with a server challenge, and register the device using Key Attestation | P0 |
| FR-M2 | Reject devices whose attestation reports software-only keys, an unlocked bootloader, or an unverified boot state, and show a clear message | P0 |
| FR-M3 | In-app camera only. There is no import from the gallery anywhere in the app | P0 |
| FR-M4 | After capture: compute SHA-256, perceptual hash, and tile hashes; build the manifest; sign it in hardware; persist locally, all in < 500 ms on a mid-range phone | P0 |
| FR-M5 | Include a recent block hash (time beacon) in the manifest when online, to prove a "not before" time | P0 |
| FR-M6 | Work offline: sign and queue locally, then upload when connectivity returns | P0 |
| FR-M7 | Show per-photo status (Signed → Pending → Anchored → Finalized) and let the user export the proof bundle | P0 |
| FR-M8 | Albums: create, add photos, share link | P1 |
| FR-M9 | Publish or unpublish the original image to enable side-by-side comparison | P1 |
| FR-M10 | Opt-in coarse GPS (3 decimal places, about 110 m), off by default | P1 |
| FR-M11 | "Share as file" option that preserves exact bytes (for exact-hash verification) | P1 |

### 5.2 API and anchoring

| ID | Requirement | Priority |
|---|---|---|
| FR-A1 | Device registration: validate the attestation chain against Google roots, the challenge, security level, boot state, app package, and signing certificate | P0 |
| FR-A2 | Accept signed capture submissions; verify the signature against the registered device key; idempotent on SHA-256 | P0 |
| FR-A3 | Every 5 minutes (only if captures are pending), build a Merkle tree and anchor its root on-chain | P0 |
| FR-A4 | Track batch lifecycle (building → submitted → confirmed → finalized), and recover from crashes or stuck transactions without losing captures | P0 |
| FR-A5 | Serve proof bundles by capture ID and by SHA-256 | P0 |
| FR-A6 | Perceptual similarity search by pHash (Hamming distance) | P0 |
| FR-A7 | Time-beacon endpoint returning a recent block number and hash | P0 |
| FR-A8 | Albums and published originals (object storage) | P1 |
| FR-A9 | Record anonymous verification outcomes for metrics (no IPs) | P1 |

### 5.3 Smart contract

| ID | Requirement | Priority |
|---|---|---|
| FR-C1 | `anchor(root, leafCount)`, callable only by `ANCHORER_ROLE`, stores root and timestamp, emits event | P0 |
| FR-C2 | `revokeDevice(keyHash, compromisedAt, reason)`, callable only by `REVOKER_ROLE` | P0 |
| FR-C3 | `verify(batchId, proof, leaf)` view, so other contracts (e.g. an insurance payout) can check provenance on-chain | P1 |
| FR-C4 | Non-upgradeable; admin role held by a multisig in production | P0 |

### 5.4 Web verifier

| ID | Requirement | Priority |
|---|---|---|
| FR-W1 | Drag-and-drop a photo; hash it **in the browser** (the photo is never uploaded for verification) | P0 |
| FR-W2 | Exact path: fetch the bundle by hash, then verify signature, Merkle proof, on-chain root, revocation, and time beacon, all client-side against a public RPC | P0 |
| FR-W3 | Perceptual path: compute pHash in the browser, search, then show "Similar to an authentic photo" with the distance (never "Authentic") | P0 |
| FR-W4 | Optionally upload a proof bundle file so verification works without the Sakshi API | P0 |
| FR-W5 | Album and capture share pages | P1 |
| FR-W6 | Tile-diff heatmap against a published original | P1 |
| FR-W7 | "How this was verified" panel listing every check, with links to the transaction on the block explorer | P0 |

---

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| **Security** | Device keys are non-exportable (hardware-backed). The server never holds user signing keys. The anchorer key has the minimum role. Secrets live only in env vars. Static analysis (Slither) and fuzz tests on contracts. See [THREAT_MODEL.md](THREAT_MODEL.md). |
| **Privacy** | No photos server-side unless the user publishes them. Only hashes go on-chain. GPS is opt-in and coarse. No IP logging on verification. |
| **Trustlessness** | Every verification check is reproducible from public data plus the proof bundle. |
| **Performance** | Capture-to-signed p95 < 500 ms. Anchor latency p95 < 10 min. Web verification p95 < 3 s. |
| **Cost** | ≤ 1 anchor tx per 5 min, so cost is independent of photo volume. Target < $5/month on Base. |
| **Availability** | The API being down must not block capture (offline queue) or verification with a bundle. |
| **Compatibility** | Android 9+ (API 28, StrongBox era); TEE fallback accepted. Evergreen browsers (WebCrypto). |
| **Accessibility** | Verdicts are conveyed by text and icon, not colour alone. WCAG AA contrast. |

---

## 7. Verification verdicts

| Verdict | Meaning |
|---|---|
| ✅ **Authentic** | Exact bytes match, signature valid, anchored, device not revoked at anchor time |
| 🟡 **Authentic — anchoring pending** | Signature valid, not yet on-chain (the upper time bound is not yet proven) |
| 🟦 **Similar to an authentic photo** | Perceptual match to a verified capture. Could be recompression **or** a local edit, so compare with the original |
| ⛔ **Device revoked** | Signed by a key that was revoked before this anchor |
| ❌ **Invalid** | A proof exists but a check failed (tampered bundle or forgery attempt) |
| ⚪ **No provenance** | Not captured with Sakshi. This does **not** mean fake |

---

## 8. Success metrics (pilot)

| Metric | Target |
|---|---|
| Pilot users (hostel) | ≥ 50 |
| Photos captured | ≥ 500 |
| Verifications performed | ≥ 100 |
| Perceptual match recall on WhatsApp-recompressed set | ≥ 95% |
| False-match rate on distinct-image set | ≤ 1% |
| Anchor cost per photo (measured) | < $0.0001 |
| Fraudulent verifications accepted | 0 |

---

## 9. Milestones

See [ROADMAP.md](ROADMAP.md). In summary: contracts and core library → API and anchoring → web verifier → Android app → albums and sharing → pilot.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Key attestation edge cases differ across OEMs | Spike on 3+ real devices in Phase 0. Accept TEE when StrongBox is unavailable |
| pHash differs between Kotlin and TypeScript implementations | One written spec ([PROTOCOL.md](PROTOCOL.md)), shared test vectors, and Hamming tolerance |
| Users screenshot or crop, breaking matches | UI encourages "share as file". Crop robustness is P2 |
| Pilot adoption | Partner with the hostel warden. Keep the flow faster than WhatsApp photos |
| Testnet instability | The chain is configurable. The anchor worker retries; captures are never lost |

## 11. Open questions
- Should published originals expire automatically (e.g. after 1 year)?
- Do we need account recovery across phones (device key = identity in v1)?
