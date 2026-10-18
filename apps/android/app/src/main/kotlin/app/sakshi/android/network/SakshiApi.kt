package app.sakshi.android.network

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

// docs/API.md. Bodies/responses are plain JSON strings (Retrofit's scalars converter), with
// serialization done explicitly via the shared `sakshiJson` instance in ApiClient.kt — this keeps
// Retrofit itself dependency-light and keeps all JSON handling in one place, which is also what
// lets the device-signed request (submitCapture) sign the EXACT bytes that get sent
// (docs/PROTOCOL.md §9): there's only ever one place those bytes are produced.
interface SakshiApi {
    @POST("/v1/devices/challenge")
    suspend fun requestChallenge(): String

    @POST("/v1/devices")
    suspend fun registerDevice(@Body body: String): String

    /** Device-signed (empty body): does the server still know this registration? */
    @GET("/v1/devices/me")
    suspend fun getMe(
        @Header("X-Sakshi-Device") deviceId: String,
        @Header("X-Sakshi-Timestamp") timestamp: String,
        @Header("X-Sakshi-Signature") signature: String,
    ): String

    @GET("/v1/time-beacon")
    suspend fun getTimeBeacon(): String

    @POST("/v1/captures")
    suspend fun submitCapture(
        @Body body: String,
        @Header("X-Sakshi-Device") deviceId: String,
        @Header("X-Sakshi-Timestamp") timestamp: String,
        @Header("X-Sakshi-Signature") signature: String,
    ): String

    @GET("/v1/captures/{id}/status")
    suspend fun getCaptureStatus(@Path("id") captureId: String): String

    /** FR-M7's bundle export just needs the raw JSON to write to a `.sakshi.json` file
     *  (docs/PROTOCOL.md §7) — the device never needs to interpret its contents. */
    @GET("/v1/captures/{id}")
    suspend fun getCapture(@Path("id") captureId: String): String
}
