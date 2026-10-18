package app.sakshi.android.network

import app.sakshi.android.data.CaptureStatus
import app.sakshi.android.ui.isOnServer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VerificationLinkTest {
    private val hash = "6748c2713490c219a7629935d92c59029a0a8242a0e95b6924d7e3eb726ab0cc"

    @Test
    fun `link carries only the hash, in the exact shape apps-web parses`() {
        // Same string asserted in apps/web/test/proof-link.test.ts ("parses the link the Android app builds").
        assertEquals(
            "https://user.github.io/sakshi/?hash=$hash",
            buildVerificationLink("https://user.github.io/sakshi", hash),
        )
        assertEquals("http://localhost:5173/?hash=$hash", buildVerificationLink("http://localhost:5173/", hash))
    }

    @Test
    fun `verifier address may have a path but not a query`() {
        assertEquals("https://user.github.io/sakshi", normalizeVerifierUrl("https://user.github.io/sakshi/"))
        assertEquals("http://192.168.1.5:5173", normalizeVerifierUrl("192.168.1.5:5173"))
        assertNull(normalizeVerifierUrl("https://verify.example.com/?hash=abc"))
        assertNull(normalizeVerifierUrl("javascript:alert(1)"))
        assertNull(normalizeVerifierUrl(""))
    }

    @Test
    fun `share link is offered once the server has the capture, and never for failed ones`() {
        assertFalse(isOnServer(CaptureStatus.SIGNED))
        assertFalse(isOnServer(CaptureStatus.QUEUED))
        assertFalse(isOnServer(CaptureStatus.FAILED))
        for (s in listOf(CaptureStatus.PENDING, CaptureStatus.SUBMITTED, CaptureStatus.CONFIRMED, CaptureStatus.FINALIZED)) {
            assertTrue(isOnServer(s), "$s")
        }
    }
}
