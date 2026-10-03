package app.sakshi.android.ui

import android.app.Application
import android.location.Location as AndroidLocation
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.sakshi.android.SakshiApplication
import app.sakshi.android.camera.ImageDecode
import app.sakshi.android.data.CaptureEntity
import app.sakshi.android.work.UploadWorker
import app.sakshi.protocol.Location
import app.sakshi.protocol.PHash
import app.sakshi.protocol.toHex
import com.google.android.gms.location.LocationServices
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale

sealed interface RegistrationState {
    data object Checking : RegistrationState
    data object Registered : RegistrationState
    data class Failed(val message: String) : RegistrationState
}

class CaptureViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = (application as SakshiApplication).repository

    private val _registration = MutableStateFlow<RegistrationState>(RegistrationState.Checking)
    val registration: StateFlow<RegistrationState> = _registration

    private val _processing = MutableStateFlow(false)
    val processing: StateFlow<Boolean> = _processing

    val captures: StateFlow<List<CaptureEntity>> =
        repository.observeCaptures().stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Eagerly, emptyList())

    init {
        viewModelScope.launch {
            repository.ensureRegistered()
                .onSuccess { _registration.value = RegistrationState.Registered }
                .onFailure { _registration.value = RegistrationState.Failed(it.message ?: "registration failed") }
        }
        // Refresh pending captures' statuses on open, not just right after a new capture — the
        // 15-minute periodic WorkManager schedule is too slow for "I just reopened the app".
        UploadWorker.runNow(application)
    }

    /** FR-M4: capture -> hash -> sign, target < 500ms (excluding the optional network beacon
     *  fetch, which runs with its own short timeout and is skipped entirely if it's slow/offline). */
    fun onPhotoCaptured(photoFile: File, locationOptedIn: Boolean) {
        viewModelScope.launch {
            _processing.value = true
            try {
                val jpegBytes = withContext(Dispatchers.IO) { photoFile.readBytes() }
                val image = withContext(Dispatchers.Default) { ImageDecode.decode(jpegBytes) }

                var phashHex = "0".repeat(16)
                var tileHexes = List(16) { "0".repeat(16) }
                if (PHash.isHashable(image.width, image.height)) {
                    withContext(Dispatchers.Default) {
                        val luma = PHash.toLuma(image)
                        phashHex = PHash.phashToHex(PHash.computeGlobalPHash(luma, image.width, image.height))
                        val tiles = PHash.computeTileHashes(luma, image.width, image.height)
                        tileHexes = (0 until 16).map { i -> tiles.copyOfRange(i * 8, i * 8 + 8).toHex() }
                    }
                }

                val beacon = repository.fetchTimeBeacon()
                val location = if (locationOptedIn) fetchCoarseLocation() else null

                repository.signCapture(photoFile, jpegBytes, image.width, image.height, phashHex, tileHexes, beacon, location)
                UploadWorker.runNow(getApplication())
            } finally {
                _processing.value = false
            }
        }
    }

    fun exportAndShare(localId: String, onReady: (File) -> Unit) {
        viewModelScope.launch {
            runCatching { repository.exportBundle(localId) }.onSuccess(onReady)
        }
    }

    /** FR-M10: opt-in, coarse only (3 decimals, ~110m) — docs/DATABASE.md §5 notes this is visible
     *  to anyone who later holds the photo, which is why it's never on by default. */
    private suspend fun fetchCoarseLocation(): Location? = runCatching {
        val client = LocationServices.getFusedLocationProviderClient(getApplication<Application>())
        val loc: AndroidLocation = client.lastLocation.await() ?: return null
        Location(lat = roundTo3Decimals(loc.latitude), lng = roundTo3Decimals(loc.longitude))
    }.getOrNull()

    private fun roundTo3Decimals(value: Double): String = String.format(Locale.ROOT, "%.3f", value)
}
