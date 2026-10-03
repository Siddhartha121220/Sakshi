package app.sakshi.android.ui

import android.content.Context
import android.widget.Toast
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.io.File

/** FR-M3: the in-app camera is the ONLY way a photo enters Sakshi — there is deliberately no
 *  gallery-import path anywhere in this screen or anywhere else in the app (CONTRIBUTING.md
 *  invariant #5), since signing an imported image would prove nothing about the camera. */
@Composable
fun CaptureScreen(
    processing: Boolean,
    locationOptedIn: Boolean,
    onLocationOptInChanged: (Boolean) -> Unit,
    onPhotoCaptured: (File) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var imageCapture by remember { mutableStateOf<ImageCapture?>(null) }

    Box(Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                cameraProviderFuture.addListener({
                    val cameraProvider = cameraProviderFuture.get()
                    val preview = Preview.Builder().build().apply { surfaceProvider = previewView.surfaceProvider }
                    val capture = ImageCapture.Builder().build()
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, capture)
                    imageCapture = capture
                }, ContextCompat.getMainExecutor(ctx))
                previewView
            },
        )

        Column(
            Modifier.align(Alignment.BottomCenter).padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Button(
                enabled = !processing,
                onClick = {
                    val capture = imageCapture ?: return@Button
                    val file = File(context.cacheDir, "sakshi-capture-${System.currentTimeMillis()}.jpg")
                    val outputOptions = ImageCapture.OutputFileOptions.Builder(file).build()
                    capture.takePicture(
                        outputOptions,
                        ContextCompat.getMainExecutor(context),
                        object : ImageCapture.OnImageSavedCallback {
                            override fun onImageSaved(output: ImageCapture.OutputFileResults) = onPhotoCaptured(file)
                            override fun onError(exception: ImageCaptureException) {
                                Toast.makeText(context, "Capture failed: ${exception.message}", Toast.LENGTH_SHORT).show()
                            }
                        },
                    )
                },
            ) {
                if (processing) CircularProgressIndicator(modifier = Modifier.padding(4.dp)) else Text("Capture")
            }
            Button(onClick = { onLocationOptInChanged(!locationOptedIn) }) {
                Text(if (locationOptedIn) "Location: on" else "Location: off")
            }
        }
    }
}
