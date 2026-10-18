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

### Easiest: the demo script
`scripts/demo.sh` (repo root) starts the chain, deploys the contract, starts the DB, API + worker and
web verifier, runs `adb reverse tcp:3000 tcp:3000`, and updates the app in place (`adb install -r`, so its
registration and captures are kept). Chain and DB persist between runs; `--reset` wipes them, after
which the app sees `UNKNOWN_DEVICE` and re-registers by itself (captures signed before that are marked
failed with a clear reason — they can't be accepted under a new key). With the debug URL
set to `http://127.0.0.1:3000` (below) the phone reaches the laptop **over the USB cable**, so the two
don't need to share a network and the laptop's IP can change freely.

### Choosing the server at runtime (Settings tab)
**Settings > Server** changes where the app sends records without a rebuild: `host:port` for a laptop on
the same Wi-Fi (`demo.sh` prints the laptop's address), `127.0.0.1:3000` over USB or Wi-Fi adb with
`adb reverse`, or a hosted `https://` URL. "Test connection" fetches a time beacon to prove it's
reachable. A different server keeps its own device registry, so switching re-registers the phone
(with a confirmation that says how many not-yet-uploaded photos that orphans). The address is parsed
strictly (`network/ServerUrl.kt`): a path or query is rejected rather than silently dropped. Applied
per request by an OkHttp interceptor, so no client rebuild is needed.

**Wireless adb** (`adb pair` / `adb connect`, see `scripts/demo.sh --help`) is written into the script
but **not yet tried on a phone**: it relies on adb's documented behaviour that `adb reverse` works over a
wireless connection exactly as over USB.

### Build-time default server
The debug build's default API base URL (what Settings > Server starts from) comes from `apps/android/local.properties` (gitignored, so each
developer's own address stays out of the repo):
```properties
sakshi.apiBaseUrl=http://127.0.0.1:3000      # via `adb reverse` over USB; or your laptop's LAN IP over Wi-Fi
```
Defaults to `http://10.0.2.2:3000` (the host loopback as seen from an **emulator**) when unset — a
real phone can't reach that, so a physical device needs the LAN IP and must be on the same network.
The debug source set also permits cleartext HTTP (`src/debug/res/xml/network_security_config.xml`);
release builds don't include that file and stay HTTPS-only.
```bash
./gradlew :app:testDebugUnitTest   # plain JVM unit tests: "Send as zip" is byte-exact, capture-date formatting
```
No instrumented (on-device) test suite yet — `:protocol`'s tests cover the byte-level logic this module
calls into, and the rest was verified by hand on a real phone (see **What's verified** below).

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
**Verified on a real phone (OnePlus CPH2381, 2026-10-03, and again 2026-10-18 with attestation enforced):**
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
- **The share sheet** — both "Send photo" and "Share proof" are written and compile, but neither has been tapped on a device.
- Opt-in location, and the Compose UI beyond the capture and list screens.

## The three buttons on each capture
| Button | What it sends | Needs the server? |
|---|---|---|
| **Send photo** | the signed JPEG as an ordinary image (WhatsApp recompresses it → verifier says `SIMILAR_TO_AUTHENTIC`) | no |
| **Send as zip** | the same JPEG inside a `.zip`, byte-for-byte (recipient unzips → verifier can say `AUTHENTIC`) | no |
| **Share link** | a link to the web verifier with only the photo's SHA-256 (`?hash=…`); it preloads the proof, and the recipient still drops the photo itself | the server must already have the capture (enabled once uploaded) |
| **Proof file** (was "Share proof") | the small `.sakshi.json` proof file: signed manifest, signature, the device's key + attestation chain, Merkle proof and anchor. For checking a photo **without trusting or reaching our API** — the verifier's "Upload a proof bundle file" link, then drop the photo | **yes** — it downloads the proof first, so it only enables once the capture is finalized, and a failure now shows a toast (it used to be swallowed silently) |

Each capture is headed by its signed capture date and time in the phone's local zone (falling back to
when the row was created if the manifest string ever fails to parse).

## Sending a photo, and the gallery copy
Each capture in "My captures" has two buttons (any status — the verifier finds the proof by the photo's
hash, so a photo can go out before it's anchored):
- **Send photo** — `image/jpeg`. Apps like WhatsApp recompress and strip this, so the recipient's bytes no
  longer match the signature and the verifier can only answer `SIMILAR_TO_AUTHENTIC`, never `AUTHENTIC`
  (invariant #7). That is the designed behaviour of the perceptual path, not a bug.
- **Send as zip** — the JPEG inside a zip. WhatsApp always delivers a zip as an opaque document, so the
  photo's bytes arrive untouched; the recipient unzips it and drops the JPEG on the verifier →
  `AUTHENTIC`. Verified: zip → unzip returns the identical SHA-256, and the gallery copy's hash is one the
  server recognises. **Not yet verified through WhatsApp itself.**

**What did not work (don't retry it):** the first "send as file" set a generic MIME type
(`application/octet-stream`) on the share intent. On the OnePlus test phone WhatsApp still sent the
capture as an image — a 1,155,822-byte original arrived as a 75,155-byte `IMG-…-WA….jpg`. Most likely
WhatsApp asks the FileProvider for the type, which derives `image/jpeg` from the `.jpg` extension; that
reason is a guess, the result is observed. Wrapping the file in a zip sidesteps type detection entirely.

**Measured, not assumed:** I recompressed the real OnePlus capture the way WhatsApp roughly does (long
edge 1600/1280/800 px, JPEG q75/q60/q50, metadata stripped) and ran `@sakshi/core`'s own pHash on each:
Hamming distance **0** from the original every time (match cutoff is 14, PROTOCOL.md §8.1); negative
controls (mirrored, cropped, rotated, noise) landed at 28-32. So a WhatsApp-recompressed photo should
verify as `SIMILAR_TO_AUTHENTIC`. Caveats: that is a PIL approximation of WhatsApp's pipeline, one photo,
not real WhatsApp output — real calibration is docs/ROADMAP.md Phase 7.

**Gallery copy.** Every new capture is also saved byte-for-byte to `Pictures/Sakshi` (`GallerySave.kt`,
no permission needed on Android 10+; skipped on Android 9, where it would need a storage permission).
This is export only: nothing reads the gallery back, so invariant #5 (no gallery *import*) holds — the
signature still covers the app-private original in `files/photos/`, and an edited gallery copy is just an
unsigned file. Captures taken before this change aren't backfilled. Neither the gallery save nor the
share buttons have been run on a device.

Photos live in `files/photos/` (they used to be in `cache/`, which the OS may purge — and the signature
covers that file). Older captures are still in `cache/`; the file provider covers both. A purged photo
makes Send say so instead of failing silently.

## Getting a capture off the device over ADB
Photos can also be pulled over ADB. (Nothing is ever *imported* from the gallery — invariant #5.) New captures are in `files/photos/`, older ones in `cache/`; the proof bundle
sits in `files/bundles/`:
```bash
adb shell run-as app.sakshi ls files/photos/ cache/      # sakshi-capture-<epochMillis>.jpg
adb exec-out run-as app.sakshi cat files/photos/<name>.jpg > capture.jpg
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
