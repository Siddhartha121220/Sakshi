package app.sakshi.android.data

import android.content.Context
import retrofit2.HttpException
import app.sakshi.android.BuildConfig
import app.sakshi.android.keystore.DeviceKeyManager
import app.sakshi.android.network.CaptureStatusResponse
import app.sakshi.android.network.ChallengeResponse
import app.sakshi.android.network.DeviceRequestSigner
import app.sakshi.android.network.RegisterDeviceRequest
import app.sakshi.android.network.RegisterDeviceResponse
import app.sakshi.android.network.SakshiApi
import app.sakshi.android.network.SubmitCaptureRequest
import app.sakshi.android.network.SubmitCaptureResponse
import app.sakshi.android.network.TimeBeaconResponse
import app.sakshi.android.network.sakshiJson
import app.sakshi.protocol.Beacon
import app.sakshi.protocol.CaptureManifest
import app.sakshi.protocol.Location
import app.sakshi.protocol.sha256
import app.sakshi.protocol.toBase64
import app.sakshi.protocol.toCanonicalBytes
import app.sakshi.protocol.toHex
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.jsonObject
import java.io.File
import java.time.Instant
import java.util.UUID

/**
 * The app's single orchestration point: registration, capture, upload, status refresh, and bundle
 * export. Kept as one plain class (no DI framework) — a handful of collaborators, constructed once
 * in SakshiApplication, doesn't earn Hilt/Dagger's generated-code weight (CONTRIBUTING.md: keep
 * dependencies minimal).
 */
class CaptureRepository(
    private val context: Context,
    private val api: SakshiApi,
    private val keyManager: DeviceKeyManager,
    private val session: DeviceSession,
    private val dao: CaptureDao,
) {
    private val signer = DeviceRequestSigner(keyManager)

    fun observeCaptures(): Flow<List<CaptureEntity>> = dao.observeAll()

    /** FR-M5: a recent block to embed in the manifest, proving a lower time bound
     *  (docs/PROTOCOL.md §6). Null when offline — the manifest is then built without one. */
    suspend fun fetchTimeBeacon(): Beacon? = runCatching {
        val response = sakshiJson.decodeFromString<TimeBeaconResponse>(api.getTimeBeacon())
        Beacon(chainId = response.chainId, blockNumber = response.blockNumber, blockHash = response.blockHash)
    }.getOrNull()

    /** FR-M1: generate the key (with attestation) and register, if this install hasn't already. */
    suspend fun ensureRegistered(): Result<Unit> = runCatching {
        if (session.isRegistered) return@runCatching

        val challengeResponse = sakshiJson.decodeFromString<ChallengeResponse>(api.requestChallenge())
        val challengeBytes = android.util.Base64.decode(challengeResponse.challenge, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING)

        val generated = keyManager.generateKey(challengeBytes)
        val registerBody = sakshiJson.encodeToString(
            RegisterDeviceRequest(
                challenge = challengeResponse.challenge,
                publicKey = generated.publicKeySpki.toBase64(),
                attestationChain = generated.attestationChainDer.map { it.toBase64() },
                appVersion = BuildConfig.VERSION_NAME,
            ),
        )
        val registerResponse = sakshiJson.decodeFromString<RegisterDeviceResponse>(api.registerDevice(registerBody))
        session.deviceId = registerResponse.deviceId
        session.securityLevel = registerResponse.securityLevel
    }

    /** FR-M3/FR-M4: hash + sign a just-captured photo and persist it locally (status SIGNED).
     *  The photo file itself is never uploaded (docs/ARCHITECTURE.md §2.1) — only this record is. */
    suspend fun signCapture(
        photoFile: File,
        photoBytes: ByteArray,
        width: Int,
        height: Int,
        phashHex: String,
        tileHexes: List<String>,
        beacon: Beacon?,
        location: Location?,
    ): CaptureEntity {
        val deviceId = session.deviceId ?: error("device not registered")
        val sha256Hex = sha256(photoBytes).toHex()

        val manifest = CaptureManifest(
            deviceId = deviceId,
            sha256 = sha256Hex,
            mime = "image/jpeg",
            width = width,
            height = height,
            phash = phashHex,
            tiles = tileHexes,
            capturedAt = Instant.now().toString(),
            appVersion = BuildConfig.VERSION_NAME,
            appBuild = BuildConfig.VERSION_CODE,
            beacon = beacon,
            location = location,
        )
        val manifestBytes = manifest.toCanonicalBytes()
        val signature = keyManager.sign(manifestBytes)

        val entity = CaptureEntity(
            localId = UUID.randomUUID().toString(),
            sha256Hex = sha256Hex,
            manifestBytesBase64 = manifestBytes.toBase64(),
            signatureBase64 = signature.toBase64(),
            photoFilePath = photoFile.absolutePath,
            width = width,
            height = height,
            capturedAt = manifest.capturedAt,
            status = CaptureStatus.SIGNED,
            createdAtEpochMs = System.currentTimeMillis(),
        )
        dao.insert(entity)
        return entity
    }

    /** FR-M6: drains locally-signed captures that haven't reached the server yet. Called from
     *  WorkManager (offline-first — captures queue locally and upload once connectivity returns). */
    suspend fun uploadPending(afterRecovery: Boolean = false) {
        for (capture in dao.getUnsubmitted()) {
            val deviceId = session.deviceId ?: return
            // Signed under an earlier registration (see RegistrationRecovery.kt): never uploadable.
            if (signingDeviceIdOf(capture.manifestBytesBase64) != deviceId) {
                dao.update(capture.copy(status = CaptureStatus.FAILED, lastError = ORPHANED_CAPTURE_REASON))
                continue
            }
            val bodyObj = SubmitCaptureRequest(manifest = capture.manifestBytesBase64, signature = capture.signatureBase64)
            val bodyText = sakshiJson.encodeToString(bodyObj)
            val headers = signer.sign(deviceId, "POST", "/v1/captures", bodyText.toByteArray(Charsets.UTF_8))

            runCatching {
                sakshiJson.decodeFromString<SubmitCaptureResponse>(
                    api.submitCapture(bodyText, headers.deviceId, headers.timestamp, headers.signatureBase64),
                )
            }.onSuccess { response ->
                dao.update(
                    capture.copy(
                        status = statusFromServer(response.status),
                        serverCaptureId = response.captureId,
                        uploadAttempts = capture.uploadAttempts + 1,
                        lastError = null,
                    ),
                )
            }.onFailure { err ->
                if (!afterRecovery && err is HttpException && isUnknownDevice(err.code(), err.response()?.errorBody()?.string())) {
                    recoverFromForgottenDevice()
                    return
                }
                dao.update(capture.copy(uploadAttempts = capture.uploadAttempts + 1, lastError = err.message))
            }
        }
    }

    /** The server answered UNKNOWN_DEVICE: everything still queued under this registration is orphaned
     *  (marked failed above on the next pass), and the app registers afresh so new photos work again. */
    private suspend fun recoverFromForgottenDevice() {
        session.clear()
        ensureRegistered().getOrThrow()
        uploadPending(afterRecovery = true) // re-runs once (never loops) with the new deviceId: orphans get marked failed, nothing else is queued
    }

    /** FR-M7: refreshes status for everything already submitted but not yet finalized. */
    suspend fun refreshStatuses() {
        for (capture in dao.getAwaitingFinalization()) {
            val serverCaptureId = capture.serverCaptureId ?: continue
            runCatching {
                sakshiJson.decodeFromString<CaptureStatusResponse>(api.getCaptureStatus(serverCaptureId))
            }.onSuccess { response ->
                dao.update(
                    capture.copy(
                        status = statusFromServer(response.status),
                        txHash = response.txHash ?: capture.txHash,
                        anchoredAt = response.anchoredAt ?: capture.anchoredAt,
                    ),
                )
            }
        }
    }

    /** FR-M7: "share as file" — fetches the full proof bundle and writes it to a shareable file. */
    suspend fun exportBundle(localId: String): File {
        val capture = dao.getByLocalId(localId) ?: error("capture not found: $localId")
        val serverCaptureId = capture.serverCaptureId ?: error("not yet submitted to the server")

        val response = sakshiJson.parseToJsonElement(api.getCapture(serverCaptureId)).jsonObject
        val bundle = response["bundle"] ?: error("server response had no bundle")

        val dir = File(context.filesDir, "bundles").apply { mkdirs() }
        val file = File(dir, "${capture.sha256Hex}.sakshi.json")
        file.writeText(bundle.toString())
        return file
    }

    private fun statusFromServer(status: String): CaptureStatus = when (status) {
        "pending" -> CaptureStatus.PENDING
        "submitted" -> CaptureStatus.SUBMITTED
        "confirmed" -> CaptureStatus.CONFIRMED
        "finalized" -> CaptureStatus.FINALIZED
        "failed" -> CaptureStatus.FAILED
        else -> CaptureStatus.PENDING
    }
}
