# :app

The Android app: in-app camera capture, Keystore key generation + attestation, signing, an
offline-first upload queue, status polling, and proof-bundle export (docs/PRD.md §5.1, docs/
ROADMAP.md Phase 5). Depends on `:protocol` for every byte-level operation (hashing, canonical
JSON, signature encoding) — see `../protocol/README.md`.

## Commands
```bash
./gradlew :app:assembleDebug   # builds a real installable APK
```
No unit/instrumented test suite here yet (see **What's verified** below) — `:protocol`'s tests are
what covers the byte-level logic this module calls into.

## Structure
| Package | What's in it |
|---|---|
| `keystore/` | `DeviceKeyManager` — Keystore key generation (StrongBox with TEE fallback), Key Attestation, signing (docs/PROTOCOL.md §2.2) |
| `camera/` | `ImageDecode` — JPEG -> RGB + EXIF orientation for `:protocol`'s pHash (the Android counterpart of `apps/web/src/lib/image-decode.ts`) |
| `network/` | `SakshiApi` (Retrofit, plain-string bodies), `ApiClient` (the shared `Json` instance), `DeviceRequestSigner` (docs/PROTOCOL.md §9) |
| `data/` | `CaptureRepository` (the app's single orchestration point), Room (`CaptureEntity`/`CaptureDao`/`AppDatabase`), `DeviceSession` |
| `work/` | `UploadWorker` — the offline-first upload queue (WorkManager) |
| `ui/` | Compose: `CaptureScreen` (camera), `CaptureListScreen` (status + share), `CaptureViewModel` |

## What's verified, and what isn't
**Verified:**
- `:protocol`'s logic (everything this module signs/hashes) — 24 tests against the same golden
  vectors `packages/core` uses, including this module's exact `CaptureManifest` field layout.
- **The whole app compiles and packages into a real, installable APK** via a from-scratch
  `./gradlew clean :app:assembleDebug` — every file in this module, the manifest, resources, and
  every third-party dependency's version actually resolve and link together (see the "Gotchas"
  section below for two dependency-resolution dead ends that didn't).

**Not verified — this module has not run on a device or emulator at all:**
- Whether `DeviceKeyManager` actually generates a StrongBox/TEE key and a real attestation chain
  on real hardware (docs/ROADMAP.md Phase 0's spike, which this project still owes).
- The Compose UI rendering, CameraX capture pipeline, Room database, WorkManager scheduling, and
  the full register -> capture -> upload -> finalize flow end to end on a device.
- I attempted to set up a local emulator in this environment specifically to close that gap — Dev
  tools are present (Android Studio, SDK, KVM access) but the one locally-present system image
  (`android-37.0/google_apis_playstore_ps16k/x86_64`) turned out to be an empty placeholder (no
  actual system image files, ~16KB total), and downloading a real one is multiple GB. That's an
  environment limitation, not a code issue — the fix is running this on a real phone or a properly
  provisioned emulator, which is exactly docs/ROADMAP.md Phase 0's outstanding spike.

## Gotchas hit while building this (left here so they don't get rediscovered)
- **`com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter`'s Gradle variant
  resolution silently failed** under AGP (its artifact resolved per `./gradlew :app:dependencies`,
  but `compileDebugKotlin` couldn't see its classes — looked like an Android/JVM variant-matching
  issue with that artifact's published Gradle Module Metadata). Fixed by dropping it entirely:
  Retrofit bodies/responses are plain `String`s (`converter-scalars`), serialized explicitly via
  the one shared `sakshiJson` instance in `ApiClient.kt`. This also has a correctness upside: it's
  what guarantees the device-signed request's hash (docs/PROTOCOL.md §9) covers the *exact* bytes
  Retrofit sends, since there's only one code path that produces them.
- **AGP 8.7.2 warns on `compileSdk = 36`** (tested only up to 35) but builds successfully anyway —
  left as a warning rather than downgrading, since `android-36.1` is what's actually installed.
