package app.sakshi.android.network

import kotlinx.serialization.Serializable

// Request/response shapes for docs/API.md. Field names match the API's JSON exactly.

@Serializable
data class ChallengeResponse(val challenge: String, val expiresAt: String)

@Serializable
data class RegisterDeviceRequest(
    val challenge: String,
    val publicKey: String, // base64 SPKI DER
    val attestationChain: List<String>, // base64 DER, leaf first
    val appVersion: String,
)

@Serializable
data class RegisterDeviceResponse(val deviceId: String, val securityLevel: String)

@Serializable
data class SubmitCaptureRequest(val manifest: String, val signature: String) // base64

@Serializable
data class SubmitCaptureResponse(val captureId: String, val status: String)

@Serializable
data class CaptureStatusResponse(val status: String, val txHash: String? = null, val anchoredAt: String? = null)

@Serializable
data class TimeBeaconResponse(val chainId: Int, val blockNumber: Long, val blockHash: String, val timestamp: String)

@Serializable
data class ApiErrorBody(val error: ApiErrorDetail)

@Serializable
data class ApiErrorDetail(val code: String, val message: String)
