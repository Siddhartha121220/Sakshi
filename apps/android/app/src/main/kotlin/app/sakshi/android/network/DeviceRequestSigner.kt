package app.sakshi.android.network

import app.sakshi.protocol.sha256
import app.sakshi.protocol.toBase64
import app.sakshi.protocol.toHex
import app.sakshi.android.keystore.DeviceKeyManager

/** Builds the X-Sakshi-* signed-request headers (docs/PROTOCOL.md §9) for a device-signed
 *  mutation. `bodyBytes` must be the EXACT bytes Retrofit will send as the request body — see
 *  ApiClient.kt's shared `sakshiJson` instance, which is what guarantees that. */
class DeviceRequestSigner(private val keyManager: DeviceKeyManager) {
    data class SignedHeaders(val deviceId: String, val timestamp: String, val signatureBase64: String)

    fun sign(deviceId: String, method: String, path: String, bodyBytes: ByteArray): SignedHeaders {
        val timestamp = (System.currentTimeMillis() / 1000).toString()
        val bodyHashHex = sha256(bodyBytes).toHex()
        val canonicalRequest = "${method.uppercase()}\n$path\n$timestamp\n$bodyHashHex"
        val signature = keyManager.sign(canonicalRequest.toByteArray(Charsets.UTF_8))
        return SignedHeaders(deviceId, timestamp, signature.toBase64())
    }
}
