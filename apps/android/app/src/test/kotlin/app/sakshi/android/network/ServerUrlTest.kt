package app.sakshi.android.network

import okhttp3.Call
import okhttp3.Connection
import okhttp3.Interceptor
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ServerUrlTest {
    @Test
    fun `bare host and port is taken as plain http, the LAN and dev case`() {
        assertEquals("http://192.168.1.5:3000", normalizeServerUrl("192.168.1.5:3000"))
        assertEquals("http://127.0.0.1:3000", normalizeServerUrl("  127.0.0.1:3000/ "))
    }

    @Test
    fun `a full https url is kept as typed`() {
        assertEquals("https://api.sakshi.app", normalizeServerUrl("https://api.sakshi.app/"))
        assertEquals("https://api.sakshi.app:8443", normalizeServerUrl("https://api.sakshi.app:8443"))
    }

    @Test
    fun `addresses that would silently send requests to the wrong place are rejected`() {
        assertNull(normalizeServerUrl(""))
        assertNull(normalizeServerUrl("   "))
        assertNull(normalizeServerUrl("ftp://example.com"))
        assertNull(normalizeServerUrl("https://example.com/api")) // a path would be dropped by the interceptor
        assertNull(normalizeServerUrl("https://example.com?x=1"))
        assertNull(normalizeServerUrl("192.168.1.5 3000"))
        assertNull(normalizeServerUrl("http://"))
    }

    @Test
    fun `interceptor sends each request to the currently configured server, keeping path and query`() {
        var configured = "http://192.168.1.5:3000"
        val interceptor = BaseUrlInterceptor { configured }

        val first = CapturingChain(Request.Builder().url("http://10.0.2.2:3000/v1/captures/abc/status?x=1").build())
        interceptor.intercept(first)
        assertEquals("http://192.168.1.5:3000/v1/captures/abc/status?x=1", first.proceeded!!.url.toString())

        configured = "https://api.sakshi.app" // changed in settings: next request goes there, no client rebuild
        val second = CapturingChain(Request.Builder().url("http://10.0.2.2:3000/v1/time-beacon").build())
        interceptor.intercept(second)
        assertEquals("https://api.sakshi.app/v1/time-beacon", second.proceeded!!.url.toString())
    }

    /** Minimal Interceptor.Chain that records the request it was asked to proceed with. */
    private class CapturingChain(private val original: Request) : Interceptor.Chain {
        var proceeded: Request? = null
        override fun request() = original
        override fun proceed(request: Request): Response {
            proceeded = request
            return Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").build()
        }
        override fun connection(): Connection? = null
        override fun call(): Call = throw UnsupportedOperationException()
        override fun connectTimeoutMillis() = 0
        override fun withConnectTimeout(timeout: Int, unit: TimeUnit) = this
        override fun readTimeoutMillis() = 0
        override fun withReadTimeout(timeout: Int, unit: TimeUnit) = this
        override fun writeTimeoutMillis() = 0
        override fun withWriteTimeout(timeout: Int, unit: TimeUnit) = this
    }
}
