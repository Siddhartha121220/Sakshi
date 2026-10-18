package app.sakshi.android.ui

import android.app.Application
import android.location.Location as AndroidLocation
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.sakshi.android.SakshiApplication
import app.sakshi.android.camera.ImageDecode
import app.sakshi.android.data.CaptureEntity
import app.sakshi.android.data.createShareZip
import app.sakshi.android.data.saveToGallery
import app.sakshi.android.network.buildVerificationLink
import app.sakshi.android.network.normalizeServerUrl
import app.sakshi.android.network.normalizeVerifierUrl
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
    private val serverSettings = (application as SakshiApplication).serverSettings

    private val _serverUrl = MutableStateFlow(serverSettings.baseUrl)
    val serverUrl: StateFlow<String> = _serverUrl
    val defaultServerUrl: String get() = serverSettings.defaultBaseUrl

    private val _verifierUrl = MutableStateFlow(serverSettings.verifierUrl)
    val verifierUrl: StateFlow<String> = _verifierUrl
    val defaultVerifierUrl: String get() = serverSettings.defaultVerifierUrl

    /** Returns an error message for the field, or null when saved. */
    fun saveVerifierUrl(input: String): String? {
        val url = normalizeVerifierUrl(input) ?: return "Not a valid web address (e.g. https://verify.example.com)."
        serverSettings.verifierUrl = url
        _verifierUrl.value = url
        return null
    }

    fun verificationLinkFor(capture: CaptureEntity): String = buildVerificationLink(serverSettings.verifierUrl, capture.sha256Hex)

    private val _registration = MutableStateFlow<RegistrationState>(RegistrationState.Checking)
    val registration: StateFlow<RegistrationState> = _registration

    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing

    private val _processing = MutableStateFlow(false)
    val processing: StateFlow<Boolean> = _processing

    val captures: StateFlow<List<CaptureEntity>> =
        repository.observeCaptures().stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Eagerly, emptyList())

    init {
        register { repository.ensureRegistered() }
        // Refresh pending captures' statuses on open, not just right after a new capture — the
        // 15-minute periodic WorkManager schedule is too slow for "I just reopened the app".
        UploadWorker.runNow(application)
    }

    private fun register(attempt: suspend () -> Result<Unit>) {
        _registration.value = RegistrationState.Checking
        viewModelScope.launch {
            attempt()
                .onSuccess { _registration.value = RegistrationState.Registered }
                .onFailure { _registration.value = RegistrationState.Failed(it.message ?: "registration failed") }
        }
    }

    /** Pull-to-refresh on the capture list. Network failures just end the spinner: each capture's own
     *  lastError already says what went wrong, and the background worker keeps retrying. */
    fun refresh() {
        if (_refreshing.value) return
        viewModelScope.launch {
            _refreshing.value = true
            try {
                runCatching { repository.syncNow() }
            } finally {
                _refreshing.value = false
            }
        }
    }

    fun retryRegistration() = register { repository.ensureRegistered() }

    /** Validates and saves a new server address, then registers this phone there. Returns an error
     *  message for the field, or null on success. */
    fun saveServerUrl(input: String): String? {
        val url = normalizeServerUrl(input)
            ?: return "Not a valid server address. Use host:port (e.g. 192.168.1.5:3000) or a full https:// URL."
        if (url == serverSettings.baseUrl) return null
        serverSettings.baseUrl = url
        _serverUrl.value = url
        register { repository.reRegister() }
        return null
    }

    fun resetServerUrl() {
        val before = serverSettings.baseUrl
        serverSettings.resetToDefault()
        _serverUrl.value = serverSettings.baseUrl
        if (before != serverSettings.baseUrl) register { repository.reRegister() }
    }

    fun testConnection(onResult: (String) -> Unit) {
        viewModelScope.launch {
            onResult("Contacting the server… (a free server that's asleep can take up to a minute to wake)")
            onResult(repository.checkServer().getOrElse { "Can't reach the server: ${it.message ?: it.javaClass.simpleName}" })
        }
    }

    fun unsubmittedCount(onResult: (Int) -> Unit) {
        viewModelScope.launch { onResult(repository.unsubmittedCount()) }
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
                // A convenience copy only — a failure here must never fail the capture itself.
                withContext(Dispatchers.IO) { runCatching { saveToGallery(getApplication(), photoFile) } }
                UploadWorker.runNow(getApplication())
            } finally {
                _processing.value = false
            }
        }
    }

    /** Zips the photo on a background thread and hands the zip to [onReady] (see ShareZip.kt for why). */
    fun prepareFileShare(photo: File, onReady: (File) -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { createShareZip(File(getApplication<Application>().cacheDir, "shared"), photo) } }
            result.getOrNull()?.let(onReady)
            result.exceptionOrNull()?.let { onError(it.message ?: it.javaClass.simpleName) }
        }
    }

    /** Fetches the proof from the server and hands the written file to [onReady]; any failure goes to
     *  [onError] with a human-readable reason rather than being swallowed (it used to be, which made the
     *  "Share proof" button look dead whenever the server was unreachable). */
    fun exportAndShare(localId: String, onReady: (File) -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            val result = runCatching { repository.exportBundle(localId) }
            result.getOrNull()?.let(onReady)
            result.exceptionOrNull()?.let { onError(it.message ?: it.javaClass.simpleName) }
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
