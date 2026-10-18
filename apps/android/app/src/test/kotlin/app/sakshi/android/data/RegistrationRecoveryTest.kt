package app.sakshi.android.data

import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RegistrationRecoveryTest {
    // The exact body apps/api/src/app.ts sends for an unregistered device.
    private val unknownDeviceBody = """{"error":{"code":"UNKNOWN_DEVICE","message":"device not registered"}}"""

    @Test
    fun `recognises the server forgetting this device`() {
        assertTrue(isUnknownDevice(401, unknownDeviceBody))
    }

    @Test
    fun `other 401s must not trigger a re-registration`() {
        // A bad signature or clock skew is not "the server forgot you"; re-registering would throw away a
        // perfectly good key and orphan every queued photo.
        assertFalse(isUnknownDevice(401, """{"error":{"code":"BAD_SIGNATURE","message":"x"}}"""))
        assertFalse(isUnknownDevice(401, """{"error":{"code":"STALE_TIMESTAMP","message":"x"}}"""))
        assertFalse(isUnknownDevice(401, null))
        assertFalse(isUnknownDevice(401, "<html>proxy error</html>"))
    }

    @Test
    fun `UNKNOWN_DEVICE on a non-401 status is ignored`() {
        assertFalse(isUnknownDevice(500, unknownDeviceBody))
    }

    @Test
    fun `reads the signing deviceId from the manifest bytes`() {
        val manifest = """{"app":{"build":1,"version":"0.1.0"},"deviceId":"998da202-83d4-4d32-90d5-c8fc0752c349","v":1}"""
        val b64 = Base64.getEncoder().encodeToString(manifest.toByteArray())
        assertEquals("998da202-83d4-4d32-90d5-c8fc0752c349", signingDeviceIdOf(b64))
    }

    @Test
    fun `an unreadable manifest yields null, which the upload loop treats as orphaned`() {
        assertNull(signingDeviceIdOf("%%% not base64 %%%"))
        assertNull(signingDeviceIdOf(Base64.getEncoder().encodeToString("{\"v\":1}".toByteArray())))
    }
}
