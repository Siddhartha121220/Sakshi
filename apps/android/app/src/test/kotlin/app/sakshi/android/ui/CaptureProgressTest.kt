package app.sakshi.android.ui

import app.sakshi.android.data.CaptureStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CaptureProgressTest {
    @Test
    fun `every status maps to a step, and steps only move forward through the lifecycle`() {
        val lifecycle = listOf(
            CaptureStatus.SIGNED, CaptureStatus.QUEUED, CaptureStatus.PENDING,
            CaptureStatus.SUBMITTED, CaptureStatus.CONFIRMED, CaptureStatus.FINALIZED,
        )
        val steps = lifecycle.map { completedSteps(it)!! }
        assertEquals(steps.sorted(), steps, "a later status must never show fewer completed steps")
        assertEquals(1, steps.first())
        assertEquals(CAPTURE_STEPS.size, steps.last(), "only FINALIZED completes the track")
    }

    @Test
    fun `failed is shown as an error, not as a position on the track`() {
        assertNull(completedSteps(CaptureStatus.FAILED))
    }

    @Test
    fun `every status is handled`() {
        // A new CaptureStatus without a mapping would be a compile error in completedSteps' `when`, but a
        // value outside 1..4 would index CAPTURE_STEPS out of range in the UI.
        for (s in CaptureStatus.entries) completedSteps(s)?.let { assertTrue(it in 1..CAPTURE_STEPS.size, "$s -> $it") }
    }

    @Test
    fun `thumbnail sample size stays a power of two and never undershoots the target`() {
        assertEquals(8, thumbnailSampleSize(3264, 2448, 256)) // real OnePlus capture -> 408x306
        assertEquals(1, thumbnailSampleSize(200, 150, 256)) // already smaller: decode as is
        assertEquals(1, thumbnailSampleSize(300, 300, 256))
        for ((w, h) in listOf(4000 to 3000, 3264 to 2448, 1080 to 1920, 512 to 512)) {
            val s = thumbnailSampleSize(w, h, 256)
            assertTrue(s and (s - 1) == 0, "power of two: $s")
            assertTrue(minOf(w, h) / s >= 256 || s == 1, "shorter side ${minOf(w, h) / s} < 256 for ${w}x$h")
        }
    }
}
