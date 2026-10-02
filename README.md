# Sakshi (साक्षी)

**Photos that can prove they're real.**

Sakshi — Sanskrit for *witness* — signs every photo inside your phone's security chip the moment it's taken, and timestamps it on a public blockchain. Anyone can later check that a photo is **unedited**, came from a **genuine camera**, and was taken **within a proven time window**, without trusting us.

> 🚧 **Status: design phase.** The docs below are the plan; the code is being built phase by phase ([roadmap](docs/ROADMAP.md)).

---

## Why

AI can fake any photo in seconds. Fakes pass as real, and real photos get dismissed as "probably AI". Detecting fakes is a losing arms race, so Sakshi proves the **real** ones instead, at capture time.

**First use case:** hostel and rental move-in / move-out evidence. No more "that crack was already there" disputes over deposits.

## How it works

1. **Capture.** The in-app camera hashes the photo and signs the fingerprint with a non-exportable key in the phone's StrongBox/TEE. Android Key Attestation proves the key lives in real hardware, inside our genuine app.
2. **Anchor.** Every 5 minutes, thousands of fingerprints are batched into one Merkle root and written to **Base** (an Ethereum L2). One transaction, whatever the volume.
3. **Verify.** Drop any photo onto the website. It's hashed **in your browser** (never uploaded), and the signature, Merkle proof, and on-chain root are checked against the public chain directly.
4. **Survives WhatsApp.** Recompressed or metadata-stripped copies are matched with perceptual hashing, and tile hashes highlight which regions were edited.

```
📱 capture → 🔐 sign in hardware → ☁️ batch → ⛓️ anchor root on Base → 🌐 anyone verifies
```

| Verdict | Meaning |
|---|---|
| ✅ Authentic | Exact image, valid signature, anchored on-chain |
| 🟦 Similar to authentic | Recompressed copy, or locally edited (compare with the original) |
| ❌ Invalid | Proof exists but was tampered with |
| ⚪ No provenance | Not taken with Sakshi (that alone doesn't mean fake) |

## Tech stack

| Layer | Tech |
|---|---|
| Mobile | Kotlin, Jetpack Compose, CameraX, Android Keystore (StrongBox/TEE), Key Attestation |
| Backend | Node.js 22, TypeScript, Fastify, PostgreSQL, viem |
| Blockchain | Solidity, Foundry, OpenZeppelin, Base L2 |
| Web | React, Vite, WebCrypto, viem |
| Crypto | ECDSA P-256, SHA-256, Merkle trees, JCS (RFC 8785), pHash/dHash |

## Documentation

| Doc | What's inside |
|---|---|
| [PRD](docs/PRD.md) | Problem, users, requirements, success metrics |
| [Architecture](docs/ARCHITECTURE.md) | System diagrams, flows, trust model, key decisions |
| [Protocol](docs/PROTOCOL.md) | Normative spec: manifest, signatures, Merkle, pHash, verification |
| [Database](docs/DATABASE.md) | Schema, ER diagram, key queries |
| [API](docs/API.md) | REST endpoints |
| [Threat model](docs/THREAT_MODEL.md) | Attacks considered and how they're stopped |
| [Roadmap](docs/ROADMAP.md) | Build phases |

## Known limitations

- Photographing a screen showing a fake image (the "analog hole") is **not detected in v1**. See the [threat model](docs/THREAT_MODEL.md#2-threats-and-mitigations).
- Android only for now.

## Repository layout

```
apps/android     Kotlin app
apps/api         API + anchor worker (+ db/migrations)
apps/web         Static web verifier
packages/contracts  Solidity (Foundry)
packages/core    Shared TS protocol library + test vectors
docs/            Design docs
```
