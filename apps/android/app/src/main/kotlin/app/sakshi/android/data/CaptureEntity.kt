package app.sakshi.android.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/** Local record of a capture, from the moment it's signed through to being anchored and
 *  finalized (docs/ARCHITECTURE.md §2.1's Room DB: "photos + proof bundles"). `status` mirrors
 *  docs/API.md's lifecycle (pending -> submitted -> confirmed -> finalized), plus the two
 *  purely-local states before the device has even talked to the server. */
enum class CaptureStatus { SIGNED, QUEUED, PENDING, SUBMITTED, CONFIRMED, FINALIZED, FAILED }

@Entity(tableName = "captures")
data class CaptureEntity(
    @PrimaryKey val localId: String, // a locally generated UUID, independent of the server's captureId
    val sha256Hex: String,
    val manifestBytesBase64: String, // the exact signed bytes (CONTRIBUTING.md invariant #1) — never re-derived
    val signatureBase64: String,
    val photoFilePath: String, // app-private JPEG file this capture's hash/signature cover
    val width: Int,
    val height: Int,
    val capturedAt: String,
    val status: CaptureStatus,
    val serverCaptureId: String? = null,
    val txHash: String? = null,
    val anchoredAt: String? = null,
    val uploadAttempts: Int = 0,
    val lastError: String? = null,
    val createdAtEpochMs: Long,
)
