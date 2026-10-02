# Sakshi — Threat Model

**What we protect:** the claim *"this exact image was captured by a genuine camera, on genuine hardware, within this time window."*

**What we do not claim:** that the scene in front of the camera was real (see T9), or that photos without Sakshi proof are fake.

---

## 1. Adversaries

| Adversary | Goal |
|---|---|
| **Fraudster** (tenant, claimant) | Get a fake or edited photo accepted as authentic, or backdate a real one |
| **Disputing party** (landlord, insurer) | Discredit a genuine photo ("the server faked it") |
| **Malicious or compromised operator** (us, or an attacker on our server) | Forge, backdate, or delete proofs |
| **Curious public** | Extract private info (location, identity) from proofs |

---

## 2. Threats and mitigations

| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| T1 | **Import an AI/edited image** into the app | There is no gallery import anywhere. Signing happens only in the CameraX capture callback | Requires app tampering → T2 |
| T2 | **Modified app** that signs arbitrary images | Key Attestation binds the key to package `app.sakshi` **and our signing certificate**. A repackaged app has a different cert, so registration is rejected | — |
| T3 | **Rooted phone / hooked runtime** (Frida, Xposed) injecting frames | Registration requires `deviceLocked` and `verifiedBootState = Verified`. Optional Play Integrity check (P1) | Zero-day exploits on locked devices. Out of scope |
| T4 | **Emulator** pretending to be a phone | Emulators only produce software-level attestation, so they're rejected (A5) | — |
| T5 | **Extract the signing key** | Keys are generated in StrongBox/TEE and are non-exportable | Hardware vulnerabilities. Mitigated by revocation (T12) |
| T6 | **Leaked OEM attestation keys** (some devices are known to have them) | Check Google's attestation revocation status list at registration and periodically re-check registered devices | Leaks not yet published |
| T7 | **Backdate a photo** (claim it was taken earlier) | The upper bound comes from the anchor block timestamp, which nobody (including us) can change | Window up to ~5–10 min, or longer for offline captures. The UI shows the window honestly |
| T8 | **Predate a photo** (pre-sign before the event) | The lower bound comes from the block-hash beacon, which is unpredictable before it exists | Offline captures have no lower bound, and the UI says so |
| T9 | **Photograph a screen or print** showing a fake (analog hole) | **Not mitigated in v1.** Documented. P2: moiré/screen detection, depth/LiDAR flatness, focus-distance metadata | **Accepted risk.** The main known limitation |
| T10 | **Tampered proof bundle** (edited manifest, swapped key) | The verifier checks JCS canonical form, signature, Merkle proof, and **on-chain root via its own RPC** | — |
| T11 | **Operator forges a capture** | Impossible without the device's hardware key. The verifier can check the attestation chain to Google (P2 in-browser) | Before P2, the verifier trusts the server's `securityLevel` claim |
| T12 | **Compromised device keeps signing** | `revokeDevice(keyHash, compromisedAt)` on-chain. Captures anchored at or after `compromisedAt` are reported as **revoked** | Captures between the compromise and the revocation tx are flagged only if `compromisedAt` is estimated correctly |
| T13 | **Operator withholds or deletes proofs** | Devices keep bundles locally (export as `.sakshi.json`). The verifier accepts bundle files. Roots live on-chain forever | Availability only, never correctness |
| T14 | **Anchorer key stolen** | The attacker can only anchor junk roots: that costs us gas but forges nothing (leaves still need device signatures). Admin (multisig) revokes the role | Gas griefing until rotated |
| T15 | **Admin key stolen** | Admin is a Safe multisig in production. The contract is non-upgradeable, so history can't be changed even by the admin | An attacker could revoke honest devices (visible on-chain, and reversible only by redeploying). Acceptable |
| T16 | **Perceptual collision attack** (craft a different image with a matching pHash) | The perceptual path only ever says *"similar to"*, never *"authentic"*, and shows the original side by side plus a tile diff | A human must compare; the UI makes that explicit |
| T17 | **Signature malleability** (re-submit a modified-`s` signature) | Captures are unique by image `sha256`. The duplicate is rejected | — |
| T18 | **Manifest ambiguity** (duplicate JSON keys, alternate encodings) | Verifiers require `JCS(parse(bytes)) == bytes` | — |
| T19 | **Request replay** on device-signed endpoints | 300 s timestamp window; all signed mutations are idempotent | — |
| T20 | **Privacy leak through location** | Opt-in only, coarse (3 decimals), never in EXIF, with an explicit warning that the location is visible to anyone holding the photo | — |
| T21 | **Privacy leak through the server** | No photos stored unless published. No IPs on verification events. On-chain data is only Merkle roots | Server logs. Keep access logs short-lived (7 days) |
| T22 | **Hash enumeration** (does photo X exist?) | Lookup requires the photo itself (its hash), so knowing the hash already implies possession | — |
| T23 | **DoS** on registration or search | Per-IP rate limits. Search is bounded (LIMIT 10, distance ≤ 14) | — |
| T24 | **Smart contract bugs** | Minimal contract, OpenZeppelin primitives, Foundry fuzz + invariant tests, Slither in CI | — |
| T25 | **Supply-chain compromise** (npm/Gradle dependency) | Lockfiles committed, minimal dependency set, Dependabot alerts, and no dependency added without justification (see CONTRIBUTING.md) | — |

---

## 3. Security levels shown to verifiers

| Level | Shown as | Meaning |
|---|---|---|
| `strongbox` | 🔒 Hardware security chip | Key lives in a dedicated secure element |
| `tee` | 🔐 Trusted execution environment | Key lives in the CPU's isolated secure world |
| software | — | Never accepted |

---

## 4. Secrets inventory

| Secret | Location | Rotation |
|---|---|---|
| `SERVER_CHALLENGE_SECRET` | API env var | Any time (it only invalidates challenges outstanding in the last 10 minutes) |
| `ANCHORER_PRIVATE_KEY` | Worker env var; a dedicated hot wallet with minimal funds | Grant the role to a new key, then revoke the old one |
| Admin role | Safe multisig (prod), deployer EOA (testnet only) | — |
| `DATABASE_URL`, S3 keys | Host secret store | Standard |

Nothing secret is ever committed. `.env.example` lists names only.
