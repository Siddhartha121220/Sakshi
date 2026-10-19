# Sakshi (साक्षी)

**Photos that can prove they're real.**

Sakshi (Sanskrit for *witness*) signs every photo inside your phone's security chip the moment it's taken, and anchors its fingerprint on a public blockchain. Anyone can later check that a photo is **unedited**, came from a **genuine phone camera**, and was taken **within a proven time window**, without having to trust the people who run Sakshi.

**Live on the Base Sepolia testnet:**

| | |
|---|---|
| Verifier website | https://siddhartha121220.github.io/Sakshi/ |
| API | https://sakshi-65ve.onrender.com (free tier: the first request after a quiet spell takes about 50 s) |
| Smart contract | [`0xf412dE9954A9d8caa35a0B6c1c6E193703765B51`](https://sepolia.basescan.org/address/0xf412dE9954A9d8caa35a0B6c1c6E193703765B51) on Base Sepolia (chain 84532) |

---

## The problem

AI can fake any photo in seconds. That breaks trust in two directions: fakes pass as real, and real photos get dismissed as "probably AI". Detecting fakes is a losing race, because each new generator beats the last detector. Sakshi does the opposite and **proves the real ones are real, at the moment of capture**.

## Use cases

- **Hostel and rental deposits** (the first target). Photograph the room at move-in. At move-out, anyone can check that the photos are untouched and were taken on that date, which settles "that crack was already there".
- **Insurance claims.** Damage photos the insurer can verify were taken by a real camera, not edited or generated.
- **Deliveries and returns.** Proof of the condition a parcel arrived in.
- **Citizen journalism and evidence.** Photos whose time and integrity can be checked by anyone, without trusting the person who took them.

## How it works

```
📱 capture → 🔐 sign in hardware → ☁️ batch → ⛓️ anchor root on Base → 🌐 anyone verifies
```

1. **Register.** On first launch the phone generates a P-256 key inside its secure hardware (TEE or StrongBox), where it can never be copied out. Android Key Attestation proves to the server, through a certificate chain ending at Google's root, that the key is genuine, the phone is locked with verified boot, and it belongs to the real Sakshi app.
2. **Capture.** The in-app camera hashes the photo (SHA-256, plus a perceptual hash and 16 tile hashes) and builds a small manifest. It includes a **time beacon**, a recent block hash that can't be known in advance. The hardware key signs that manifest. The photo itself never leaves the phone.
3. **Anchor.** The server batches all new fingerprints into one Merkle tree and writes only its 32-byte root to the `SakshiAnchor` contract. One cheap transaction covers any number of photos, and nobody, including us, can change or backdate it.
4. **Verify.** Drop a photo on the website. It's hashed **in your browser** (never uploaded), then the signature, the Merkle proof and the on-chain root are checked against the chain directly. The server only delivers proofs; it's never trusted for the verdict.

**Proven time window:** the beacon proves the photo wasn't signed *before* a certain block, and the anchor proves it existed *by* a later block. Both come from the chain, so neither the phone's clock nor the server can fake them.

| Verdict | Meaning |
|---|---|
| ✅ Authentic | Exact file, valid hardware signature, anchored on-chain, device not revoked |
| 🟦 Similar to authentic | Not the exact file but looks like a verified original (for example after WhatsApp recompression). Never upgraded to Authentic |
| ❌ Invalid | A proof exists but fails a check (tampered or edited) |
| ⚪ No provenance | Not taken with Sakshi. That alone doesn't mean it's fake |
| 🚫 Device revoked | The signing phone's key was revoked on-chain before this photo was anchored |

### Sharing a photo from the app

| Button | What it sends | Verifier result |
|---|---|---|
| **Send as zip** | The exact original inside a zip, which messaging apps deliver untouched | ✅ Authentic (after unzipping) |
| **Send photo** | An ordinary image. WhatsApp and similar apps recompress it | 🟦 Similar to authentic |
| **Share link** | A verifier link holding only the photo's fingerprint, never the photo. The recipient still needs the photo itself | Preloads the proof |
| **Proof file** | A `.sakshi.json` proof that works even if the Sakshi server is offline | Upload it, then the photo |

Every photo is also saved to the phone's gallery (`Pictures/Sakshi`), so it isn't lost if the app is removed.

## Try it

**Install the app (Android 9+).** [**Download Sakshi.apk**](https://github.com/Siddhartha121220/Sakshi/releases/latest/download/Sakshi.apk) — it points at the live server by default, so no setup is needed. On the phone, allow "install unknown apps" for wherever you opened the file, install it, and grant camera access. It registers itself automatically. (This is a debug build, not a Play Store release — Android will warn you it's from an unverified developer; that's expected for a student project shared this way.)

You can also build it yourself from source (below).

Then take a photo and watch it move through the four steps: **Signed → Uploaded → Anchored → Verified on-chain**. On the real testnet, the last step takes about 15 to 30 minutes, because a Base block only counts as final once it's settled on Ethereum.

---

## Run it yourself

### Prerequisites

- Node.js 20+ and pnpm 10 (`corepack enable`)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`, `anvil`)
- For the Android app: JDK 17, the Android SDK, and a phone with USB debugging on

```bash
git clone https://github.com/Siddhartha121220/Sakshi.git
cd Sakshi
pnpm install
(cd packages/contracts \
  && forge install foundry-rs/forge-std --no-git --no-commit \
  && forge install OpenZeppelin/openzeppelin-contracts@v5.7.0 --no-git --no-commit \
  && forge build)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

### Option A: everything local, in one command

```bash
scripts/demo.sh            # chain + contract + database + API + website + phone over USB
scripts/demo.sh --reset    # start over with an empty chain and database
scripts/demo.sh --no-phone # laptop side only
```

This starts a local Anvil chain, deploys the contract, starts an embedded Postgres-compatible database, the API with its anchor worker, and the website at http://localhost:5173. If a phone is plugged in, it also updates the app on it and forwards the API over the USB cable, so the phone and laptop don't need to share a network. State persists between runs.

For the app, create `apps/android/local.properties`:

```properties
sdk.dir=/path/to/Android/Sdk
sakshi.apiBaseUrl=http://127.0.0.1:3000
sakshi.verifierUrl=http://localhost:5173
```

and build it with `cd apps/android && ./gradlew :app:assembleDebug` before running `demo.sh`.

**Real attestation locally:** a real phone needs `DEV_SKIP_ATTESTATION=false`, and your debug signing certificate's digest in `ALLOWED_APP_CERT_DIGESTS` in `apps/api/.env`. Read the digest from the APK with `apksigner verify --print-certs app-debug.apk`.

### Option B: deploy your own public instance (all free tiers)

1. **Wallet and contract (Base Sepolia).** Make a testnet-only wallet (`cast wallet new`) and fund it with free Base Sepolia ETH from a faucet. 0.0001 ETH covers the deploy plus over 150 anchors. Put its key in `packages/contracts/.env.sepolia`, which is gitignored:
   ```
   DEPLOYER_PRIVATE_KEY=0x...
   ANCHORER_ADDRESS=0x<your wallet address>
   REVOKER_ADDRESS=0x<your wallet address>
   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
   ```
   Then deploy:
   ```bash
   cd packages/contracts
   set -a; . ./.env.sepolia; set +a
   forge script script/Deploy.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast
   ```
2. **Database (Neon).** Create a free Postgres project and copy its connection string. Use the **direct** connection, without `-pooler` in the host: the anchor worker relies on a session lock that pooled connections drop. Create the tables:
   ```bash
   DATABASE_URL='postgresql://...' pnpm --filter api db:migrate
   ```
3. **API (Render).** Create a free **Web Service** from your fork, in the same region as the database:
   - Build command: `corepack enable && pnpm install --frozen-lockfile --prod=false`
   - Start command: `pnpm --filter api start` (the API and anchor worker in one process)
   - Environment: `NODE_ENV=production`, `NODE_VERSION=20`, `DATABASE_URL` (direct), `SERVER_CHALLENGE_SECRET` (from `openssl rand -hex 32`), `ALLOWED_APP_CERT_DIGESTS` (your APK's signing digest), `CHAIN_ID=84532`, `RPC_URL=https://sepolia.base.org`, `SAKSHI_ANCHOR_CONTRACT` (from step 1), `ANCHORER_PRIVATE_KEY` (the wallet key), `ANCHOR_INTERVAL_MS=60000`, `TRUST_PROXY=1` (so rate limits apply per visitor, not to everyone behind Render's proxy)
4. **Website (GitHub Pages).** In your fork, edit the `env` block of `.github/workflows/deploy-web.yml` (API URL, contract address, and `VITE_BASE=/<your-repo-name>/`). Then go to repo **Settings → Pages → Source: GitHub Actions** and push.
5. **App.** Set `sakshi.apiBaseUrl` and `sakshi.verifierUrl` in `local.properties` to your Render and Pages URLs, then build. The server and verifier addresses can also be changed later in the app's **Settings** tab, with no rebuild.

Never commit `.env*` files or wallet keys. Production should split the deployer, anchorer and revoker roles and put admin behind a multisig (see the [threat model](docs/THREAT_MODEL.md)).

## Tests

```bash
pnpm -r test                                    # TypeScript: core library, API, web verifier
pnpm -r typecheck
cd packages/contracts && forge test             # Solidity: unit, fuzz, invariant
cd apps/android && ./gradlew :protocol:test :app:testDebugUnitTest
```

The suites run against real dependencies rather than mocks: a real local chain, an embedded Postgres-compatible database, real cryptography, and an Android attestation chain captured from a physical phone. The Kotlin and TypeScript implementations share test vectors, so both produce byte-identical hashes and signatures.

## Tech stack

| Layer | Tech |
|---|---|
| Mobile | Kotlin, Jetpack Compose, CameraX, Android Keystore (TEE/StrongBox), Key Attestation, Room, WorkManager |
| Backend | Node.js, TypeScript, Fastify, PostgreSQL, viem |
| Blockchain | Solidity, Foundry, OpenZeppelin, Base (Ethereum L2) |
| Web | React, Vite, WebCrypto, viem |
| Crypto | ECDSA P-256, SHA-256, Merkle trees, JCS (RFC 8785), pHash/dHash |

## Repository layout

```
apps/android        Android app (:app) + pure-Kotlin protocol port (:protocol)
apps/api            REST API + anchor worker; db/migrations is the schema
apps/web            Static web verifier
packages/contracts  SakshiAnchor.sol (Foundry), deploy script, deployment records
packages/core       Shared TypeScript protocol library + cross-language test vectors
scripts/demo.sh     One-command local stack
docs/               Design docs
```

## Documentation

| Doc | What's inside |
|---|---|
| [PRD](docs/PRD.md) | Problem, users, requirements |
| [Architecture](docs/ARCHITECTURE.md) | Components, flows, trust model, key decisions |
| [Protocol](docs/PROTOCOL.md) | Normative spec: manifest, signatures, Merkle, pHash, verification |
| [Database](docs/DATABASE.md) | Schema and key queries |
| [API](docs/API.md) | REST endpoints |
| [Threat model](docs/THREAT_MODEL.md) | Attacks considered and how they're stopped |
| [Roadmap](docs/ROADMAP.md) | What's done, what's next, what's verified |
| [Contributing](CONTRIBUTING.md) | Invariants, conventions, commands |

## Known limitations

- **The "analog hole":** photographing a screen or print that shows a fake isn't detected. Sakshi proves the camera captured *something*, not that the scene was genuine.
- **Android only.** Tested on one phone so far (TEE key); StrongBox hardware and other manufacturers are untested.
- **Testnet.** Runs on Base Sepolia, not mainnet. The free API tier sleeps when idle.
- **Uncalibrated similarity cutoff.** The perceptual-match threshold still needs calibrating on a large image set.
