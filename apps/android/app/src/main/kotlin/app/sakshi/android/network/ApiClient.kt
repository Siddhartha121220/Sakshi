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

fun createSakshiApi(baseUrl: String, debug: Boolean): SakshiApi {
    val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .apply {
            if (debug) addInterceptor(HttpLoggingInterceptor().setLevel(HttpLoggingInterceptor.Level.BASIC))
        }
        .build()

    val retrofit = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(client)
        .addConverterFactory(ScalarsConverterFactory.create())
        .build()

    return retrofit.create(SakshiApi::class.java)
}
