package app.sakshi.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

/** Builds the exact same logical manifest as packages/core/test-vectors/jcs.json's
 *  "manifest-shaped" case and checks the resulting bytes match byte-for-byte — the most direct
 *  proof that Manifest.kt's field layout agrees with packages/core/src/manifest.ts's. */
class ManifestTest {
    private fun expectedHex(): String {
        val text = javaClass.classLoader.getResourceAsStream("jcs.json")!!.bufferedReader().readText()
        val array = Json.parseToJsonElement(text) as JsonArray
        val entry = array.first { ((it as JsonObject)["name"] as JsonPrimitive).content == "manifest-shaped" } as JsonObject
        return (entry["canonicalUtf8Hex"] as JsonPrimitive).content
    }

    @Test
    fun `matches the shared manifest-shaped vector byte-for-byte`() {
        val manifest = CaptureManifest(
            deviceId = "0192f1c2-1234-7890-abcd-ef0123456789",
            sha256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            mime = "image/jpeg",
            width = 4000,
            height = 3000,
            phash = "c3a1000000000000",
            tiles = (0..15).map { it.toString(16).padStart(16, '0') },
            capturedAt = "2026-10-02T10:42:13.512Z",
            appVersion = "0.1.0",
            appBuild = 1,
        )

        assertEquals(expectedHex(), manifest.toCanonicalBytes().toHex())
    }

    @Test
    fun `rejects a manifest with the wrong number of tiles`() {
        kotlin.test.assertFailsWith<IllegalArgumentException> {
            CaptureManifest(
                deviceId = "0192f1c2-1234-7890-abcd-ef0123456789",
                sha256 = "a".repeat(64),
                mime = "image/jpeg",
                width = 100,
                height = 100,
                phash = "0".repeat(16),
                tiles = listOf("a".repeat(16)),
                capturedAt = "2026-10-02T10:42:13.512Z",
                appVersion = "0.1.0",
                appBuild = 1,
            )
        }
    }

    @Test
    fun `includes beacon and location only when present, and omits them otherwise`() {
        val withExtras = CaptureManifest(
            deviceId = "0192f1c2-1234-7890-abcd-ef0123456789",
            sha256 = "a".repeat(64),
            mime = "image/jpeg",
            width = 100,
            height = 100,
            phash = "0".repeat(16),
            tiles = (0..15).map { "0".repeat(16) },
            capturedAt = "2026-10-02T10:42:13.512Z",
            appVersion = "0.1.0",
            appBuild = 1,
            beacon = Beacon(84532, 17234567L, "0x" + "ab".repeat(32)),
            location = Location("12.972", "77.595"),
        )
        val withoutExtras = withExtras.copy(beacon = null, location = null)

        val withBytes = withExtras.toCanonicalBytes().toString(Charsets.UTF_8)
        val withoutBytes = withoutExtras.toCanonicalBytes().toString(Charsets.UTF_8)

        kotlin.test.assertTrue(withBytes.contains("\"beacon\""))
        kotlin.test.assertTrue(withBytes.contains("\"location\""))
        kotlin.test.assertTrue(!withoutBytes.contains("\"beacon\""))
        kotlin.test.assertTrue(!withoutBytes.contains("\"location\""))
    }
}
