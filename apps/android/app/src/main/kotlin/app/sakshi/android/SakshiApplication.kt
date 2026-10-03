package app.sakshi.android

import android.app.Application
import app.sakshi.android.data.CaptureRepository
import app.sakshi.android.data.AppDatabase
import app.sakshi.android.data.DeviceSession
import app.sakshi.android.keystore.DeviceKeyManager
import app.sakshi.android.network.createSakshiApi
import app.sakshi.android.work.UploadWorker

/** Manual DI container: a handful of collaborators, constructed once here (CONTRIBUTING.md: keep
 *  dependencies minimal — this doesn't earn Hilt/Dagger's generated-code weight). */
class SakshiApplication : Application() {
    val repository: CaptureRepository by lazy {
        val api = createSakshiApi(BuildConfig.API_BASE_URL, debug = BuildConfig.DEBUG)
        CaptureRepository(
            context = this,
            api = api,
            keyManager = DeviceKeyManager(),
            session = DeviceSession(this),
            dao = AppDatabase.get(this).captureDao(),
        )
    }

    override fun onCreate() {
        super.onCreate()
        UploadWorker.schedule(this)
    }
}
