# :protocol

Pure-Kotlin/JVM port of `packages/core` (TypeScript): JCS canonicalisation, SHA-256, DER⟷raw ECDSA
signature conversion, perceptual hashing, and the capture manifest — docs/PROTOCOL.md. Deliberately
has **no Android dependency**, so it builds and tests with plain Gradle, no emulator or device
needed, and is reused unchanged by the `:app` module.

## Commands
```bash
./gradlew :protocol:test
```

## Why this module exists separately from `:app`
`CONTRIBUTING.md` invariant #8 requires Kotlin and TypeScript to agree byte-for-byte on these
algorithms. Keeping that logic in an Android-free module means:
- it's testable with a one-line `gradle test`, not an instrumented/emulator test
- `packages/core/test-vectors/*.json` (committed, golden, cross-language) can be loaded directly as
  JVM test resources and checked bit-for-bit

## Test vectors
`src/test/resources/*.json` are **copies** of `packages/core/test-vectors/*.json` — all of them
except `merkle.json`, which Android never needs (only the API's anchor worker and the web verifier
build/check Merkle trees; the device only ever signs). Not a build-time sync: after regenerating
vectors there (`pnpm --filter @sakshi/core generate-vectors`), re-copy the relevant ones here and
re-run `./gradlew :protocol:test`.

## A confirmed (not hypothetical) cross-language floating-point edge case
`PHashTest.kt`'s `horizontal-gradient` vector differs from the TypeScript-computed hash by a few
bits, not because of a logic bug, but because that specific synthetic image is numerically
degenerate: nearly all 64 of its DCT coefficients sit at the floating-point noise floor (~1e-15),
including the value the median threshold is computed from. A single ULP of difference between
Java's and V8's `cos()` is then enough to flip which side of ~0 a coefficient lands on. The other
three vectors — including `checkerboard-8`, which has just as much real image structure — match
bit-for-bit exactly, and a real photo's sensor noise keeps coefficients well clear of that floor.
See `KNOWN_FLOATING_POINT_EDGE_CASES` in the test for the (small, explicit) tolerance this earns.

## Not yet verified against a real device
This module's logic is proven against the same fixtures as the TypeScript implementation. It has
**not** been exercised with a real Android Keystore, a real camera capture, or real Key Attestation
— that's `docs/ROADMAP.md` Phase 0's still-outstanding spike. `:app`'s `DeviceKeyManager` and
`CaptureProcessor` (which do use real Keystore/CameraX APIs) are correspondingly unverified beyond
compiling — see `apps/android/app/README.md`.
