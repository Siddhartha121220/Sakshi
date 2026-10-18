package app.sakshi.android.network

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Turns what a person types into the server-address field into a usable base URL, or null if it
 * can't be one. Accepts "192.168.1.5:3000" (assumes http, the common LAN/dev case) or a full
 * "https://api.example.com". Anything with a path, query or non-http scheme is rejected rather than
 * guessed at, since a wrong guess silently sends every request to the wrong place.
 */
fun normalizeServerUrl(input: String): String? {
    // Scheme first, THEN let HttpUrl handle trailing slashes: trimming "/" up front turned "http://" into
    // "http:", which then parsed as a host literally named "http".
    val trimmed = input.trim()
    if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return null
    val withScheme = if ("://" in trimmed) trimmed else "http://$trimmed"
    val url = withScheme.toHttpUrlOrNull() ?: return null
    if (url.scheme != "http" && url.scheme != "https") return null
    if (url.encodedPath != "/" || url.query != null || url.fragment != null) return null
    return url.toString().trimEnd('/')
}

/** Points every request at the currently configured server, so changing the address in settings
 *  takes effect on the next request with no client rebuild. Paths come from SakshiApi as usual. */
class BaseUrlInterceptor(private val currentBaseUrl: () -> String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val target: HttpUrl = currentBaseUrl().toHttpUrlOrNull() ?: return chain.proceed(chain.request())
        val rewritten = chain.request().url.newBuilder()
            .scheme(target.scheme)
            .host(target.host)
            .port(target.port)
            .build()
        return chain.proceed(chain.request().newBuilder().url(rewritten).build())
    }
}
