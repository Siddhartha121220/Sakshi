# :app

The Android app: in-app camera capture, Keystore key generation + attestation, signing, an
offline-first upload queue, status polling, and proof-bundle export (docs/PRD.md §5.1, docs/
ROADMAP.md Phase 5). Depends on `:protocol` for every byte-level operation (hashing, canonical
JSON, signature encoding) — see `../protocol/README.md`.

## Commands
```bash
./gradlew :app:assembleDebug   # builds a real installable APK
adb install app/build/outputs/apk/debug/app-debug.apk
```

### Pointing the debug build at your API
The debug build's API base URL comes from `apps/android/local.properties` (gitignored, so each
developer's own address stays out of the repo):
```properties
sakshi.apiBaseUrl=http://192.168.1.42:3000   # your dev machine's LAN IP
```
Defaults to `http://10.0.2.2:3000` (the host loopback as seen from an **emulator**) when unset — a
real phone can't reach that, so a physical device needs the LAN IP and must be on the same network.
The debug source set also permits cleartext HTTP (`src/debug/res/xml/network_security_config.xml`);
release builds don't include that file and stay HTTPS-only.
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
**Verified on a real phone (OnePlus CPH2381, 2026-10-03):**
- `DeviceKeyManager` generates a genuine hardware-backed P-256 key and a real 4-certificate Key
  Attestation chain that chains to Google's Hardware Attestation Root. StrongBox was unavailable,
  so it fell back to TEE exactly as designed. The captured chain is fixtured at
  `apps/api/test/fixtures/real-attestation-oneplus-cph2381.json`.
- The full flow end to end: in-app capture -> sign -> upload -> Merkle batch -> anchor on a local
  Anvil chain -> `finalized` -> **AUTHENTIC** in the web verifier.
- CameraX capture, Room persistence, the WorkManager upload queue, and status polling all ran.

**Verified by build, not by running:**
- `:protocol`'s logic — 24 tests against the same golden vectors `packages/core` uses.
- The APK builds from a from-scratch `./gradlew clean :app:assembleDebug`.

**Still not verified:**
- **Any second device or OEM.** One phone can't tell you which of its behaviours are universal;
  docs/ROADMAP.md Phase 0 asks for 3+.
- **StrongBox.** This device didn't have it, so that branch and the `strongbox` security level
  have never executed.
- **Registration with attestation actually enforced.** The run used `DEV_SKIP_ATTESTATION=true`, so
  the server accepted the device without checking its chain. The chain is real and now verifies
  offline in `apps/api/test/real-attestation.test.ts`, but the live path hasn't rejected or
  accepted a real device on its own merits yet.
- **The share sheet / bundle export UI** — the proof bundle was pulled over ADB instead.
- Opt-in location, and the Compose UI beyond the capture and list screens.

## Getting a capture off the device
Photos deliberately never reach the gallery (invariant #5 — there is no gallery path in or out),
so pull them over ADB. They live in the app's private cache; the proof bundle sits beside them:
```bash
adb shell run-as app.sakshi ls cache/                    # sakshi-capture-<epochMillis>.jpg
adb exec-out run-as app.sakshi cat cache/<name>.jpg > capture.jpg
adb shell run-as app.sakshi ls files/bundles/            # <sha256>.sakshi.json
```
`adb pull` can't reach app-private storage on a non-rooted device, and `run-as ... cp` into
`/sdcard/` is blocked by scoped storage — piping through `exec-out cat` is what works. Check the
pulled file's size matches the device's before blaming anything downstream.

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
