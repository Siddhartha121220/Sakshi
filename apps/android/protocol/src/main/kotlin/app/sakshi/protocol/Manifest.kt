package app.sakshi.protocol

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

// Capture manifest: docs/PROTOCOL.md §3. Mirrors packages/core/src/manifest.ts's shape; built here
// as a plain data class since the Android app only ever PRODUCES its own manifest (signs and
// submits it) and never parses one back — unlike the API/web verifier, which must parse arbitrary
// manifests and so carry a full zod schema.

data class Beacon(val chainId: Int, val blockNumber: Long, val blockHash: String)
data class Location(val lat: String, val lng: String) // exactly 3 decimal places, as strings

data class CaptureManifest(
    val deviceId: String,
    val sha256: String, // 64 lowercase hex chars
    val mime: String,
    val width: Int,
    val height: Int,
    val phash: String, // 16 lowercase hex chars
    val tiles: List<String>, // exactly 16 entries, 16 hex chars each
    val capturedAt: String, // ISO-8601 UTC, e.g. Instant.toString()
    val appVersion: String,
    val appBuild: Int,
    val beacon: Beacon? = null,
    val location: Location? = null,
) {
    init {
        require(tiles.size == 16) { "manifest requires exactly 16 tile hashes, got ${tiles.size}" }
    }

    fun toJson(): JsonObject = buildJsonObject {
        put("v", 1)
        put("type", "sakshi.capture")
        put("deviceId", deviceId)
        put("sha256", sha256)
        put("mime", mime)
        put("width", width)
        put("height", height)
        put("phash", phash)
        putJsonArray("tiles") { tiles.forEach { add(it) } }
        put("capturedAt", capturedAt)
        beacon?.let {
            putJsonObject("beacon") {
                put("chainId", it.chainId)
                put("blockNumber", it.blockNumber)
                put("blockHash", it.blockHash)
            }
        }
        location?.let {
            putJsonObject("location") {
                put("lat", it.lat)
                put("lng", it.lng)
            }
        }
        putJsonObject("app") {
            put("version", appVersion)
            put("build", appBuild)
        }
    }
}

/** Canonicalises the manifest to its signed bytes (docs/PROTOCOL.md §3.2). */
fun CaptureManifest.toCanonicalBytes(): ByteArray = jcsEncode(toJson()).toByteArray(Charsets.UTF_8)
