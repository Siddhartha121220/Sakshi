# Sakshi — REST API (v1)

Base URL: `/v1`. JSON everywhere. Hashes are lowercase hex without `0x`, except EVM values (`0x…`). Binary blobs are base64.

**Auth levels**
- **Public** — no auth.
- **Device** — signed with the device key; headers per [PROTOCOL.md §9](PROTOCOL.md#9-device-authenticated-api-requests).

**Errors** — always `{ "error": { "code": "STRING_CODE", "message": "human readable" } }` with a matching HTTP status.

**Rate limits** — per IP. Public reads: 60/min. Similarity search: 20/min. Registration: 5/hour.

---

## Devices

### `POST /v1/devices/challenge` — Public
Response `200`:
```json
{ "challenge": "base64url…", "expiresAt": "2026-10-02T10:52:00Z" }
```

### `POST /v1/devices` — Public
Registers a device after verifying Android Key Attestation (PROTOCOL §2.3).
```json
{
  "challenge": "base64url…",
  "publicKey": "base64 SPKI DER",
  "attestationChain": ["base64 DER (leaf)", "…", "base64 DER (root)"],
  "appVersion": "0.1.0"
}
```
`201`:
```json
{ "deviceId": "uuid", "securityLevel": "strongbox" }
```
Errors: `400 INVALID_CHALLENGE`, `422 ATTESTATION_FAILED` (with `reason`: `UNTRUSTED_ROOT`, `REVOKED_CERT`, `SOFTWARE_KEY`, `UNLOCKED_BOOTLOADER`, `WRONG_APP`, `KEY_MISMATCH`), `409 DEVICE_EXISTS`.

---

## Time beacon

### `GET /v1/time-beacon` — Public
A block about 1 minute old (cached ~10 s).
```json
{ "chainId": 84532, "blockNumber": 17234567, "blockHash": "0xabc…", "timestamp": "2026-10-02T10:41:00Z" }
```

---

## Captures

### `POST /v1/captures` — Device
```json
{ "manifest": "base64 JCS bytes", "signature": "base64 DER" }
```
The server checks that the signature is valid for the registered key, that `manifest.deviceId` matches the header device, that the manifest is JCS-canonical, that the schema is valid, that the device isn't revoked, and, if a beacon is present, that the beacon block exists.

- `202` (new): `{ "captureId": "uuid", "status": "pending" }`
- `200` (same `sha256` already submitted by **this** device): same body. Idempotent retry.
- `409 DUPLICATE_IMAGE` if a different device submitted this hash.
- `400 INVALID_MANIFEST`, `401 BAD_SIGNATURE`, `403 DEVICE_REVOKED`.

### `GET /v1/captures/{id}` — Public
### `GET /v1/captures/by-hash/{sha256}` — Public
Both return the capture summary plus the full proof bundle:
```json
{
  "captureId": "uuid",
  "status": "pending | submitted | confirmed | finalized",
  "securityLevel": "strongbox",
  "originalUrl": "https://… | null",
  "bundle": { "format": "sakshi.proof", "version": 1, "…": "see PROTOCOL §7" }
}
```
`404 NOT_FOUND`. While a capture is pending, `bundle.anchor` is omitted.

### `POST /v1/captures/search-similar` — Public
```json
{ "phash": "c3a1…(16 hex)" }
```
`200`:
```json
{ "candidates": [ { "captureId": "uuid", "distance": 4 } ] }
```
At most 10 candidates, distance ≤ 14, closest first. The client then fetches and **verifies** each candidate's bundle itself.

### `GET /v1/captures/{id}/status` — Public
A lightweight poll for the app: `{ "status": "…", "txHash": "0x… | null", "anchoredAt": "… | null" }`.

### `PUT /v1/captures/{id}/original` — Device (owner only)
Body: raw JPEG bytes (`Content-Type: image/jpeg`, max 25 MB). The server **requires `sha256(body) == capture.sha256`**, so only the exact signed image can be published.
`200`: `{ "originalUrl": "https://…" }`. Errors: `403 NOT_OWNER`, `422 HASH_MISMATCH`, `413 TOO_LARGE`.

### `DELETE /v1/captures/{id}/original` — Device (owner only)
Deletes the object. `204`.

---

## Albums

### `POST /v1/albums` — Device
`{ "title": "Room 204 — move-in", "description": "optional" }` → `201 { "albumId", "shareSlug", "shareUrl" }`

### `POST /v1/albums/{id}/captures` — Device (owner only)
`{ "captureId": "uuid", "caption": "optional" }` → `204`. `403` if the capture belongs to another device.

### `DELETE /v1/albums/{id}/captures/{captureId}` — Device (owner only) → `204`

### `GET /v1/albums/{shareSlug}` — Public
```json
{
  "title": "…", "description": "…", "createdAt": "…",
  "captures": [ { "captureId": "uuid", "position": 0, "caption": "…", "originalUrl": "… | null", "status": "finalized" } ]
}
```

### `DELETE /v1/albums/{id}` — Device (owner only) → `204`

---

## Batches

### `GET /v1/batches/{id}` — Public
`{ "id", "chainId", "contract", "onchainBatchId", "root", "leafCount", "txHash", "blockNumber", "blockTimestamp", "status" }`

---

## Metrics

### `POST /v1/verification-events` — Public (fire-and-forget from the web verifier)
`{ "captureId": "uuid | null", "method": "exact", "verdict": "authentic", "hammingDistance": null }` → `204`

---

## Ops

### `GET /healthz` — Public
`{ "ok": true, "db": true, "rpc": true, "pendingCaptures": 12, "lastAnchorAt": "…" }`
