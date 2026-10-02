# Sakshi Protocol Specification — v1

This is the **normative** spec. The Android app (Kotlin), the API (TypeScript), and the web verifier (TypeScript) must all implement it **byte-for-byte**. If code and this document disagree, one of them is a bug: fix the code or update this document in the same PR.

Shared test vectors live in `packages/core/test-vectors/` and are consumed by both the Kotlin and TypeScript test suites.

Key words MUST, SHOULD, and MAY are used as in RFC 2119.

---

## 1. Primitives

| Name | Definition |
|---|---|
| `sha256(x)` | SHA-256, 32 bytes |
| `keccak256(x)` | Ethereum Keccak-256, 32 bytes |
| `hex(x)` | Lowercase hex, **no** `0x` prefix (except EVM values, see below) |
| EVM values | Block hashes, tx hashes, Merkle roots, and leaves use `0x`-prefixed lowercase hex |
| Signature scheme | ECDSA over **NIST P-256 (secp256r1)** with SHA-256. Android Keystore cannot hold secp256k1 keys, which is why P-256 is used |
| Signature encoding | ASN.1 DER (what Android Keystore emits). Verifiers using WebCrypto MUST convert DER → raw `r‖s` (64 bytes) |
| Public key encoding | X.509 SubjectPublicKeyInfo (SPKI), DER |
| `deviceKeyHash` | `sha256(SPKI DER)` — used on-chain for revocation |

---

## 2. Device registration

### 2.1 Challenge (stateless)
```
ts        = uint64 big-endian, unix seconds
rand      = 16 random bytes
mac       = HMAC-SHA256(SERVER_CHALLENGE_SECRET, ts ‖ rand)[0..16]
challenge = base64url(ts ‖ rand ‖ mac)        // 40 bytes → 54 chars
```
Valid for **10 minutes**. No database row is needed. Replaying a registration is harmless because the public key is unique.

### 2.2 Key generation (device)
- Algorithm EC, curve `secp256r1`, purpose `SIGN`, digest `SHA-256`.
- `setIsStrongBoxBacked(true)`; on `StrongBoxUnavailableException`, retry without it (TEE).
- `setAttestationChallenge(challengeBytes)` — the raw 40 bytes, not the base64 string.
- Alias: `sakshi-device-key-v1`. One key per installation.

### 2.3 Attestation checks (server) — all MUST pass

| # | Check |
|---|---|
| A1 | The certificate chain verifies up to a current **Google Hardware Attestation root** |
| A2 | No certificate in the chain appears in Google's attestation revocation status list |
| A3 | Leaf certificate public key == submitted `publicKey` |
| A4 | KeyDescription extension (`1.3.6.1.4.1.11129.2.1.17`) `attestationChallenge` == challenge, and the challenge MAC and expiry are valid |
| A5 | `attestationSecurityLevel` ∈ {TrustedEnvironment, StrongBox} (software → reject) |
| A6 | `rootOfTrust.deviceLocked == true` and `verifiedBootState == Verified` |
| A7 | `attestationApplicationId.packageName == "app.sakshi"` and its signature digest ∈ `ALLOWED_APP_CERT_DIGESTS` (the debug cert is allowed only when `NODE_ENV != production`) |
| A8 | Key properties: algorithm EC, curve P-256, purpose SIGN |

The server stores `securityLevel` (`strongbox` / `tee`), which is shown to verifiers.

---

## 3. Capture manifest

### 3.1 Fields

```jsonc
{
  "v": 1,                                   // protocol version, integer
  "type": "sakshi.capture",
  "deviceId": "0192f1c2-…",                 // UUID from registration
  "sha256": "9f86d0…",                      // hex(sha256(image file bytes)), 64 chars
  "mime": "image/jpeg",
  "width": 4000,                            // pixels, after EXIF orientation
  "height": 3000,
  "phash": "c3a1…",                          // 16 hex chars, §5.1
  "tiles": ["…", "…"],                      // exactly 16 × 16 hex chars, §5.2
  "capturedAt": "2026-10-02T10:42:13.512Z", // device clock (a claim, not a proof)
  "beacon": {                               // OPTIONAL, omitted when offline, §6
    "chainId": 84532,
    "blockNumber": 17234567,
    "blockHash": "0xabc…"
  },
  "location": { "lat": "12.972", "lng": "77.595" }, // OPTIONAL, opt-in, exactly 3 decimals, STRINGS
  "app": { "version": "0.1.0", "build": 1 }
}
```

Rules:
- Optional fields are **omitted**, never `null`.
- **No floating-point numbers anywhere.** Coordinates are decimal strings because float serialisation differs between Kotlin and JS. All integers MUST be < 2^53.
- The image file is the exact JPEG bytes produced by the camera pipeline. The app MUST NOT write GPS into EXIF; location lives only in the manifest, and only when opted in.

### 3.2 Canonical bytes
- Producers MUST serialise the manifest with **JCS (RFC 8785)** and UTF-8 encode it. The result is `manifestBytes`.
- The signed `manifestBytes` are authoritative and are transported and stored **verbatim** (base64). Never store them only as parsed JSON: Postgres `jsonb` reorders keys and would break signatures.
- Verifiers MUST reject a manifest where `JCS(parse(manifestBytes)) != manifestBytes`. This rejects duplicate keys and other ambiguity tricks.

### 3.3 Derived values
```
manifestDigest  = sha256(manifestBytes)
signature       = ECDSA_P256_SHA256_Sign(deviceKey, manifestBytes)   // DER
signatureDigest = sha256(signature)
```
A capture is unique by `sha256`. The API rejects a second submission with the same image hash. This also defuses ECDSA signature malleability.

---

## 4. Merkle anchoring

- Library: **OpenZeppelin StandardMerkleTree** (`@openzeppelin/merkle-tree`). It is compatible with OZ `MerkleProof.sol`.
- Leaf encoding: `["bytes32", "bytes32"]` → `[manifestDigest, signatureDigest]`.
- Leaf hash (done by the library): `keccak256(bytes.concat(keccak256(abi.encode(manifestDigest, signatureDigest))))`. The double hash prevents second-preimage attacks.
- Internal nodes use sorted-pair keccak256 (commutative), so a proof is just a `bytes32[]`.
- Batch: all `pending` captures at tick time (max 10,000). One `anchor(root, leafCount)` transaction.
- An anchored batch proves every capture in it **existed no later than** the block timestamp of the anchor transaction.

---

## 5. Perceptual hashing

Both implementations MUST follow these steps exactly. Platform image scalers (Android `Bitmap.createScaledBitmap`, canvas `drawImage`) MUST NOT be used for the downscaling steps, because they differ across platforms. Use the box filter defined below.

### 5.0 Pre-processing (shared)
1. Decode the image to RGB.
2. **Apply the EXIF orientation**, so the pixels are rotated as displayed. Messaging apps bake rotation into pixels, so this step is required for matching.
3. Luma: `Y = 0.299·R + 0.587·G + 0.114·B` (float64, range 0–255).
4. Images with width or height < 64 px are not hashable, so treat them as no match.

**Box downscale** `box(img, W, H → w, h)`: output pixel `(x, y)` = mean of source pixels with
`floor(x·W/w) ≤ sx < floor((x+1)·W/w)` and `floor(y·H/h) ≤ sy < floor((y+1)·H/h)`.

### 5.1 Global pHash (64-bit)
1. `S = box(Y → 32 × 32)`.
2. 2-D DCT-II (orthonormal) of `S`.
3. Take the 8 × 8 low-frequency block `C[u][v]`, `u, v ∈ 0..7`.
4. `m` = median of the 64 values (mean of the 32nd and 33rd sorted values).
5. Bit `i = 8u + v` is `1` if `C[u][v] > m`. Bit 0 is the **most significant** bit.
6. Encode as 16 lowercase hex chars. In Postgres, store it as a signed `BIGINT` (two's complement of the same 64 bits).

### 5.2 Tile hashes (16 × 64-bit, for edit localisation)
1. Split the oriented luma image into a 4 × 4 grid. Tile `(r, c)` covers columns `floor(c·W/4) … floor((c+1)·W/4)-1` and rows similarly. Tiles are ordered row-major.
2. Per tile: `T = box(tile → 9 × 8)`; bit `8·row + col` = `T[row][col] < T[row][col+1]` (a dHash). Bit 0 is the MSB.
3. 16 hex chars per tile.

### 5.3 Matching thresholds (initial, to be calibrated in Phase 7)
| Hamming distance (global) | Interpretation |
|---|---|
| 0–8 | Likely the same image (recompressed or resized) |
| 9–14 | Possibly related. Show it only alongside tile-diff evidence |
| > 14 | No match |

A tile with distance > 10 is highlighted as **changed** in the heatmap.

---

## 6. Time beacon (lower time bound)

- When the camera screen opens, and every 30 s while it stays open, the app fetches `GET /v1/time-beacon` → `{chainId, blockNumber, blockHash}` (a block ~1 minute old, for stability).
- The beacon is embedded in the manifest. Since a block hash is unpredictable before the block exists, the photo was **signed no earlier than** that block's timestamp.
- Verifiers MUST check `eth_getBlockByNumber(blockNumber).hash == blockHash` against their **own** RPC, not the Sakshi API.
- **Proven time window** = `[beaconBlock.timestamp, anchorBlock.timestamp]`. If there's no beacon, the lower bound is "unknown". `capturedAt` is displayed separately, labelled "device clock".

---

## 7. Proof bundle (`*.sakshi.json`)

A self-contained file that lets anyone verify a photo without the Sakshi API.

```jsonc
{
  "format": "sakshi.proof",
  "version": 1,
  "manifest": "<base64 of manifestBytes>",
  "signature": "<base64 of DER signature>",
  "device": {
    "publicKey": "<base64 SPKI DER>",
    "securityLevel": "strongbox",            // or "tee"
    "attestationChain": ["<base64 cert DER>", "…"]   // leaf first
  },
  "anchor": {                                 // omitted while pending
    "chainId": 84532,
    "contract": "0x…",
    "batchId": 42,
    "root": "0x…",
    "proof": ["0x…", "0x…"],
    "txHash": "0x…"
  }
}
```

---

## 8. Verification algorithm

Input: an image file, plus a proof bundle (from the file or from `GET /v1/captures/by-hash/{sha256}`).

```
1  h = hex(sha256(fileBytes))
2  bundle = providedBundle ?? api.byHash(h)
   if no bundle → PERCEPTUAL PATH (§8.1)
3  M = parse(manifestBytes); require JCS(M) == manifestBytes         else INVALID
4  require M.sha256 == h                                              else INVALID
5  require ECDSA_verify(device.publicKey, manifestBytes, signature)   else INVALID
6  (P2) verify attestationChain in-browser per §2.3                  else INVALID
7  if no anchor → AUTHENTIC_PENDING
8  leaf = StandardMerkleTree.leafHash([sha256(manifestBytes), sha256(signature)])
9  require MerkleProof.verify(proof, root, leaf)                      else INVALID
10 onchain = contract.batches(batchId)   // via verifier's own RPC
   require onchain.root == root                                       else INVALID
11 c = contract.deviceCompromisedAt(sha256(publicKey))
   if c != 0 and onchain.timestamp >= c → DEVICE_REVOKED
12 if M.beacon: require getBlock(M.beacon.blockNumber).hash == M.beacon.blockHash  else INVALID
13 → AUTHENTIC  (+ time window, securityLevel, "device later revoked" note if c != 0)
```

### 8.1 Perceptual path
1. Compute `phash` and `tiles` of the uploaded image in the browser (§5).
2. `POST /v1/captures/search-similar {phash}` → candidates with distance ≤ 14.
3. For each candidate, run steps 3–13 on **the candidate's own bundle** (without step 4), proving the candidate is authentic.
4. Report `SIMILAR_TO_AUTHENTIC` with the distance and the tile diff. Never report `AUTHENTIC` on this path.
5. No candidates → `NO_PROVENANCE`.

---

## 9. Device-authenticated API requests

Device-owned mutations (submit capture, publish original, albums) are signed with the device key. There are no passwords or sessions in v1.

```
X-Sakshi-Device:    <deviceId>
X-Sakshi-Timestamp: <unix seconds>
X-Sakshi-Signature: base64(DER ECDSA_P256_SHA256(deviceKey, canonicalRequest))

canonicalRequest = METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + hex(sha256(body))
```
The server rejects requests whose clock skew exceeds 300 s. Replay within that window is tolerated because all signed mutations are idempotent.

---

## 10. Versioning
- Bump `v` / `version` for any breaking change. Verifiers MUST reject unknown major versions with a clear message rather than guessing.
