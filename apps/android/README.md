# Sakshi Android

Two Gradle modules:
- **[`:protocol`](protocol/README.md)** — pure-Kotlin/JVM port of `packages/core`. Build/test this
  with plain `gradle`, no emulator needed.
- **[`:app`](app/README.md)** — the actual Android app (Compose, CameraX, Keystore, Room,
  WorkManager). Builds into a real APK; not yet run on a device or emulator — see its README.

```bash
./gradlew :protocol:test
./gradlew :app:assembleDebug
```
