package app.sakshi.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.sakshi.android.ui.SettingsScreen
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Button
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import app.sakshi.android.ui.CaptureListScreen
import app.sakshi.android.ui.CaptureScreen
import app.sakshi.android.ui.CaptureViewModel
import app.sakshi.android.ui.RegistrationState
import app.sakshi.android.ui.theme.SakshiTheme

private enum class Screen { CAPTURE, LIST, SETTINGS }

class MainActivity : ComponentActivity() {
    private val viewModel: CaptureViewModel by viewModels()

    private val requestCameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestCameraPermission.launch(Manifest.permission.CAMERA)
        }

        setContent {
            SakshiTheme {
                Surface(Modifier.fillMaxSize()) {
                    var screen by remember { mutableStateOf(Screen.CAPTURE) }
                    var locationOptedIn by remember { mutableStateOf(false) }
                    val registration by viewModel.registration.collectAsState()
                    val processing by viewModel.processing.collectAsState()
                    val captures by viewModel.captures.collectAsState()
                    val serverUrl by viewModel.serverUrl.collectAsState()
                    val refreshing by viewModel.refreshing.collectAsState()
                    val verifierUrl by viewModel.verifierUrl.collectAsState()

                    Scaffold(
                        bottomBar = {
                            NavigationBar {
                                NavigationBarItem(
                                    selected = screen == Screen.CAPTURE,
                                    onClick = { screen = Screen.CAPTURE },
                                    icon = { Icon(Icons.Filled.AddCircle, contentDescription = null) },
                                    label = { Text("Capture") },
                                )
                                NavigationBarItem(
                                    selected = screen == Screen.LIST,
                                    onClick = { screen = Screen.LIST },
                                    icon = { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null) },
                                    label = { Text("My captures (${captures.size})") },
                                )
                                NavigationBarItem(
                                    selected = screen == Screen.SETTINGS,
                                    onClick = { screen = Screen.SETTINGS },
                                    icon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                                    label = { Text("Settings") },
                                )
                            }
                        },
                    ) { padding ->
                        Column(Modifier.fillMaxSize().padding(padding)) {
                            if (screen == Screen.SETTINGS) {
                                // Reachable even when registration failed — that's when a wrong server address needs fixing.
                                SettingsScreen(
                                    serverUrl = serverUrl,
                                    defaultServerUrl = viewModel.defaultServerUrl,
                                    registration = registration,
                                    onSave = viewModel::saveServerUrl,
                                    onReset = viewModel::resetServerUrl,
                                    onTestConnection = viewModel::testConnection,
                                    onRetryRegistration = viewModel::retryRegistration,
                                    countUnsubmitted = viewModel::unsubmittedCount,
                                    verifierUrl = verifierUrl,
                                    defaultVerifierUrl = viewModel.defaultVerifierUrl,
                                    onSaveVerifier = viewModel::saveVerifierUrl,
                                )
                            } else {
                                when (val state = registration) {
                                    RegistrationState.Checking -> CenteredMessage("Registering this phone with the server…")
                                    is RegistrationState.Failed -> CenteredMessage(
                                        "Couldn't register with the server: ${state.message}",
                                        action = "Retry" to viewModel::retryRegistration,
                                        secondary = "Server settings" to { screen = Screen.SETTINGS },
                                    )
                                    RegistrationState.Registered -> when (screen) {
                                        Screen.CAPTURE -> CaptureScreen(
                                            processing = processing,
                                            locationOptedIn = locationOptedIn,
                                            onLocationOptInChanged = { locationOptedIn = it },
                                            onPhotoCaptured = { file -> viewModel.onPhotoCaptured(file, locationOptedIn) },
                                        )
                                        else -> CaptureListScreen(
                                            captures = captures,
                                            refreshing = refreshing,
                                            onRefresh = viewModel::refresh,
                                            onShareLink = { capture -> shareText(viewModel.verificationLinkFor(capture)) },
                                            onSendPhoto = { capture, asFile -> sendPhoto(java.io.File(capture.photoFilePath), asFile) },
                                            onShare = { capture ->
                                                viewModel.exportAndShare(
                                                    capture.localId,
                                                    onReady = { file -> shareFile(file) },
                                                    onError = { reason ->
                                                        Toast.makeText(
                                                            this@MainActivity,
                                                            "Couldn't fetch the proof from the server ($reason). Is it reachable?",
                                                            Toast.LENGTH_LONG,
                                                        ).show()
                                                    },
                                                )
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /** "Send photo" shares the JPEG as an image: apps like WhatsApp recompress and strip it, so the recipient's
     *  bytes no longer match the signature and the verifier can only say SIMILAR_TO_AUTHENTIC.
     *  "Send as zip" shares it inside a zip, which those apps deliver untouched — the only route to AUTHENTIC. */
    private fun sendPhoto(file: java.io.File, asFile: Boolean) {
        if (!file.exists()) {
            Toast.makeText(this, "This photo is no longer stored on the device.", Toast.LENGTH_LONG).show()
            return
        }
        if (asFile) {
            viewModel.prepareFileShare(
                file,
                onReady = { zip -> startShare(zip, "application/zip", "Send original (zip)") },
                onError = { Toast.makeText(this, "Couldn't prepare the file: $it", Toast.LENGTH_LONG).show() },
            )
        } else {
            startShare(file, "image/jpeg", "Send photo")
        }
    }

    private fun startShare(file: java.io.File, mimeType: String, title: String) {
        val uri = FileProvider.getUriForFile(this, "app.sakshi.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(intent, title))
    }

    /** "Share link": plain text, so it pastes anywhere (WhatsApp, email, notes). */
    private fun shareText(link: String) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, "Check this photo with Sakshi (you'll need the photo itself too): $link")
        }
        startActivity(Intent.createChooser(intent, "Share verification link"))
    }

    private fun shareFile(file: java.io.File) {
        val uri = FileProvider.getUriForFile(this, "app.sakshi.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/json"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(intent, "Share proof bundle"))
    }
}

/** A message centred in the content area, with up to two actions (e.g. "Retry" and "Server settings"). */
@Composable
private fun CenteredMessage(text: String, action: Pair<String, () -> Unit>? = null, secondary: Pair<String, () -> Unit>? = null) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text, textAlign = TextAlign.Center)
        action?.let { (label, onClick) -> Button(onClick = onClick, modifier = Modifier.padding(top = 16.dp)) { Text(label) } }
        secondary?.let { (label, onClick) -> TextButton(onClick = onClick) { Text(label) } }
    }
}
