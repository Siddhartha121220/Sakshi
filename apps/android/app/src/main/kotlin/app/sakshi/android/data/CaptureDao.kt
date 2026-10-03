package app.sakshi.android.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface CaptureDao {
    @Insert
    suspend fun insert(capture: CaptureEntity)

    @Update
    suspend fun update(capture: CaptureEntity)

    @Query("SELECT * FROM captures ORDER BY createdAtEpochMs DESC")
    fun observeAll(): Flow<List<CaptureEntity>>

    @Query("SELECT * FROM captures WHERE localId = :localId")
    suspend fun getByLocalId(localId: String): CaptureEntity?

    /** Not yet successfully submitted — what WorkManager's upload worker drains (FR-M6). */
    @Query("SELECT * FROM captures WHERE status IN ('SIGNED', 'QUEUED') ORDER BY createdAtEpochMs ASC")
    suspend fun getUnsubmitted(): List<CaptureEntity>

    /** Submitted but not yet finalized — what status polling (FR-M7) refreshes. */
    @Query("SELECT * FROM captures WHERE status IN ('PENDING', 'SUBMITTED', 'CONFIRMED') AND serverCaptureId IS NOT NULL")
    suspend fun getAwaitingFinalization(): List<CaptureEntity>
}
