package app.sakshi.android.ui

import java.time.ZoneId
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals

class CapturedAtFormatTest {
    private val ist = ZoneId.of("Asia/Kolkata")

    @Test
    fun `UTC manifest time is shown in the phone's local zone`() {
        assertEquals("03 Oct 2026, 09:39:19 PM", formatCapturedAt("2026-10-03T16:09:19.318736Z", 0, ist, Locale.ENGLISH))
    }

    @Test
    fun `offset timestamps resolve to the same instant`() {
        assertEquals("03 Oct 2026, 09:39:19 PM", formatCapturedAt("2026-10-03T21:39:19+05:30", 0, ist, Locale.ENGLISH))
    }

    @Test
    fun `an unparseable manifest time falls back to the row's creation time instead of showing nothing`() {
        assertEquals("03 Oct 2026, 09:16:13 PM", formatCapturedAt("not-a-date", 1_791_042_373_163, ist, Locale.ENGLISH))
    }
}
