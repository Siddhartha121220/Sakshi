package app.sakshi.android.data

import app.sakshi.android.network.ApiErrorBody
import app.sakshi.android.network.sakshiJson
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.Base64

/**
 * Recovery when the server no longer knows this install's device (its data was reset, e.g.
 * scripts/demo.sh --reset). The app then re-registers, which necessarily means a NEW hardware key:
 * attestation binds the server's challenge into the key at generation time, so an old key can't be
 * re-attested. Captures already signed by the old key therefore can never be accepted — they are
 * marked failed with this reason instead of retrying forever (the photos themselves stay on the phone
 * and in the gallery).
 */
const val ORPHANED_CAPTURE_REASON =
    "The server no longer recognises the device registration that signed this photo, so it can't be anchored. " +
        "The photo is still saved in your gallery."

/** True when an API error is the server saying it doesn't know this device (docs/API.md). */
fun isUnknownDevice(httpCode: Int, errorBody: String?): Boolean {
    if (httpCode != 401 || errorBody.isNullOrBlank()) return false
    val code = runCatching { sakshiJson.decodeFromString(ApiErrorBody.serializer(), errorBody).error.code }.getOrNull()
    return code == "UNKNOWN_DEVICE"
}

/** The deviceId a capture was signed under, read from its own signed manifest bytes. */
fun signingDeviceIdOf(manifestBytesBase64: String): String? = runCatching {
    val json = String(Base64.getDecoder().decode(manifestBytesBase64), Charsets.UTF_8)
    sakshiJson.parseToJsonElement(json).jsonObject["deviceId"]?.jsonPrimitive?.content
}.getOrNull()
