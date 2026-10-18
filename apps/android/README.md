# Sakshi Android

Two Gradle modules:
- **[`:protocol`](protocol/README.md)** — pure-Kotlin/JVM port of `packages/core`. Build/test this
  with plain `gradle`, no emulator needed.
- **[`:app`](app/README.md)** — the actual Android app (Compose, CameraX, Keystore, Room,
  WorkManager). Verified end to end on a real phone (OnePlus CPH2381, 2026-10-03): real TEE-backed
  key, real attestation chain, capture verified as AUTHENTIC. One device only, and StrongBox is
  still unexercised — see its README for the full list of what that run did and didn't prove.

```bash
./gradlew :protocol:test
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
```
