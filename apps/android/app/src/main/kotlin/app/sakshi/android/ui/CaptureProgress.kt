package app.sakshi.android.ui

import app.sakshi.android.data.CaptureStatus

/** The four user-facing steps a capture moves through, shown as a progress row on each capture. */
val CAPTURE_STEPS = listOf("Signed", "Uploaded", "Anchored", "Verified on-chain")

/** How many of [CAPTURE_STEPS] are complete for a status (0..4), or null for FAILED, which is shown
 *  as an error instead of a position on the track. "Anchored" means the root is on-chain (confirmed);
 *  the last step is finality, after which the photo verifies as AUTHENTIC. */
fun completedSteps(status: CaptureStatus): Int? = when (status) {
    CaptureStatus.SIGNED, CaptureStatus.QUEUED -> 1
    CaptureStatus.PENDING, CaptureStatus.SUBMITTED -> 2
    CaptureStatus.CONFIRMED -> 3
    CaptureStatus.FINALIZED -> 4
    CaptureStatus.FAILED -> null
}

/** BitmapFactory inSampleSize (a power of two) that decodes a [width]x[height] image to at least
 *  [targetPx] on its shorter side without loading the full-resolution photo for a list thumbnail. */
fun thumbnailSampleSize(width: Int, height: Int, targetPx: Int): Int {
    var sample = 1
    while (minOf(width, height) / (sample * 2) >= targetPx) sample *= 2
    return sample
}
