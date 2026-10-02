# @sakshi/core

Shared TypeScript implementation of [docs/PROTOCOL.md](../../docs/PROTOCOL.md): JCS canonicalisation,
DER⟷raw ECDSA signature conversion, perceptual hashing, Merkle leaf/proof handling, and the full
bundle `verifyBundle()` algorithm (PROTOCOL §8). Used by both `apps/api` and `apps/web`, so this is
the one place that logic is implemented — Kotlin (`apps/android`, Phase 5) must match it exactly,
which is what `test-vectors/` is for.

## Commands
```bash
pnpm --filter @sakshi/core test              # vitest
pnpm --filter @sakshi/core typecheck
pnpm --filter @sakshi/core generate-vectors  # regenerate test-vectors/*.json
```

## Modules
| File | What it does |
|---|---|
| `bytes.ts` | hex/base64 conversions, concat |
| `sha256.ts` | SHA-256 via WebCrypto (works in Node 20+ and every evergreen browser) |
| `jcs.ts` | RFC 8785 canonicalisation + the "is this already canonical" check |
| `signature.ts` | DER ⟷ raw ECDSA P-256 conversion, sign/verify, keygen (for tests) |
| `phash.ts` | Perceptual + tile (edit-localising) hashing — pure pixel math, no image codec dependency |
| `manifest.ts` | zod schema + build/parse for the capture manifest |
| `bundle.ts` | zod schema for the proof bundle (PROTOCOL §7) |
| `merkle.ts` | Thin wrapper over `@openzeppelin/merkle-tree` with Sakshi's fixed leaf encoding |
| `chain.ts` | `ChainReader` — the minimal RPC interface `verifyBundle` needs, so this package never depends on viem |
| `verify.ts` | `verifyBundle()` — PROTOCOL §8 end to end |

**Not implemented here (by design):**
- Image decoding / EXIF orientation — platform-specific, done by the caller before calling `toLuma`.
- §8.1's perceptual-search orchestration — needs a network call to the API, so it lives in `apps/web` (Phase 4), built on repeated `verifyBundle()` calls.
- §8 step 6 (in-browser attestation-chain verification) — P2 in docs/ROADMAP.md; `securityLevel` is currently trusted from the bundle.

## Test vectors
`test-vectors/*.json` are committed, golden, known-answer outputs (not derived at test time) for:
JCS canonicalisation, DER⟷raw signature encoding, perceptual hashes of synthetic images, and a
Merkle tree with its proofs. Regenerate with `pnpm generate-vectors` after changing any of those
algorithms, review the diff, and commit — these files are the cross-language contract.
