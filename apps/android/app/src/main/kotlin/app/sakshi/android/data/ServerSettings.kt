package app.sakshi.android.data

import android.content.Context
import app.sakshi.android.BuildConfig

/** The API server this install talks to: the build's default (BuildConfig.API_BASE_URL, from
 *  local.properties for debug builds) unless the person set another one in the app's settings. */
class ServerSettings(context: Context) {
    private val prefs = context.getSharedPreferences("sakshi_server", Context.MODE_PRIVATE)

    val defaultBaseUrl: String get() = BuildConfig.API_BASE_URL

    var baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, null) ?: defaultBaseUrl
        set(value) = prefs.edit().putString(KEY_BASE_URL, value).apply()

    val isCustom: Boolean get() = prefs.contains(KEY_BASE_URL)

    fun resetToDefault() = prefs.edit().remove(KEY_BASE_URL).apply()

    val defaultVerifierUrl: String get() = BuildConfig.VERIFIER_URL

    /** Where "Share link" sends recipients (the web verifier). */
    var verifierUrl: String
        get() = prefs.getString(KEY_VERIFIER_URL, null) ?: defaultVerifierUrl
        set(value) = prefs.edit().putString(KEY_VERIFIER_URL, value).apply()

    private companion object {
        const val KEY_BASE_URL = "base_url"
        const val KEY_VERIFIER_URL = "verifier_url"
    }
}
