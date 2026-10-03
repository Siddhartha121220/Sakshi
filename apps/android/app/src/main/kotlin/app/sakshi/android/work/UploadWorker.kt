package app.sakshi.android.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.sakshi.android.SakshiApplication
import java.util.concurrent.TimeUnit

/** FR-M6/FR-M7: drains the local upload queue and refreshes statuses, whenever there's network —
 *  this is what makes capture offline-first (sign immediately, upload whenever connectivity
 *  returns) rather than requiring the app to be online at capture time. */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val repository = (applicationContext as SakshiApplication).repository
        return try {
            repository.uploadPending()
            repository.refreshStatuses()
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val UNIQUE_WORK_NAME = "sakshi-upload-worker"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val request = PeriodicWorkRequestBuilder<UploadWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(UNIQUE_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        /** Runs immediately (e.g. right after a capture), on top of the periodic schedule above —
         *  WorkManager's minimum periodic interval is 15 minutes, too slow for "just captured". */
        fun runNow(context: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val request = androidx.work.OneTimeWorkRequestBuilder<UploadWorker>().setConstraints(constraints).build()
            WorkManager.getInstance(context).enqueue(request)
        }
    }
}
