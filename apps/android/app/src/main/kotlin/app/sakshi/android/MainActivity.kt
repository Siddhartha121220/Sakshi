package app.sakshi.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
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

private enum class Screen { CAPTURE, LIST }

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

                    Scaffold(
                        bottomBar = {
                            Column {
                                Button(onClick = { screen = Screen.CAPTURE }) { Text("Capture") }
                                Button(onClick = { screen = Screen.LIST }) { Text("My captures (${captures.size})") }
                            }
                        },
                    ) { padding ->
                        Column(Modifier.fillMaxSize()) {
                            when (val state = registration) {
                                RegistrationState.Checking -> Text("Registering this device…", Modifier.fillMaxSize())
                                is RegistrationState.Failed -> Text("Registration failed: ${state.message}", Modifier.fillMaxSize())
                                RegistrationState.Registered -> when (screen) {
                                    Screen.CAPTURE -> CaptureScreen(
                                        processing = processing,
                                        locationOptedIn = locationOptedIn,
                                        onLocationOptInChanged = { locationOptedIn = it },
                                        onPhotoCaptured = { file -> viewModel.onPhotoCaptured(file, locationOptedIn) },
                                    )
                                    Screen.LIST -> CaptureListScreen(
                                        captures = captures,
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
