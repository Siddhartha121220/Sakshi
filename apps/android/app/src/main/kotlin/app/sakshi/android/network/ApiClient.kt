package app.sakshi.android.network

import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.scalars.ScalarsConverterFactory
import java.util.concurrent.TimeUnit

/** The one shared `Json` instance — used to (de)serialize every request/response body manually
 *  (see SakshiApi.kt), and by CaptureRepository to independently compute a request body's hash for
 *  signing (docs/PROTOCOL.md §9). Everything going through this one instance is what guarantees the
 *  signed bytes are exactly the bytes sent. */
val sakshiJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

/** [currentBaseUrl] is read on every request (see BaseUrlInterceptor), so the server can be changed at runtime. */
fun createSakshiApi(currentBaseUrl: () -> String, debug: Boolean): SakshiApi {
    val client = OkHttpClient.Builder()
        .addInterceptor(BaseUrlInterceptor(currentBaseUrl))
        // Generous on purpose: free hosting tiers (e.g. Render) sleep when idle and take ~50 s to answer
        // the first request. A 15 s read timeout made every upload against a sleeping server fail with
        // "timeout" — and the request that timed out was the one waking it. Uploads run in the
        // background, so waiting is cheap; a dead server still fails, just later.
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .apply {
            if (debug) addInterceptor(HttpLoggingInterceptor().setLevel(HttpLoggingInterceptor.Level.BASIC))
        }
        .build()

    val retrofit = Retrofit.Builder()
        .baseUrl(currentBaseUrl())
        .client(client)
        .addConverterFactory(ScalarsConverterFactory.create())
        .build()

    return retrofit.create(SakshiApi::class.java)
}
