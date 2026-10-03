package app.sakshi.android.data

import android.content.Context

/** The two small, local-only facts about this install's registration — plain SharedPreferences is
 *  enough for two strings, no need for a database table or DataStore dependency. */
class DeviceSession(context: Context) {
    private val prefs = context.getSharedPreferences("sakshi_device_session", Context.MODE_PRIVATE)

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        set(value) = prefs.edit().putString(KEY_DEVICE_ID, value).apply()

    var securityLevel: String?
        get() = prefs.getString(KEY_SECURITY_LEVEL, null)
        set(value) = prefs.edit().putString(KEY_SECURITY_LEVEL, value).apply()

    val isRegistered: Boolean get() = deviceId != null

    companion object {
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_SECURITY_LEVEL = "security_level"
    }
}
