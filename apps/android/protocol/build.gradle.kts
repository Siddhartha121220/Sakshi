plugins {
    kotlin("jvm")
    kotlin("plugin.serialization") version "2.0.21"
}

// Pure JVM module, deliberately with NO Android dependency: this is the part that must produce
// byte-identical output to packages/core (TypeScript) — see CONTRIBUTING.md invariant #8 and
// packages/core/test-vectors/. Keeping it Android-free means it's testable with plain `gradle test`
// here, with no emulator/device needed, and reusable from the `app` module unchanged.
// (Repositories are declared once, centrally, in settings.gradle.kts.)

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    testImplementation(kotlin("test"))
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}
