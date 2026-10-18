package app.sakshi.android.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.sakshi.android.camera.ImageDecode
import app.sakshi.android.data.CaptureEntity
import app.sakshi.android.data.CaptureStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** FR-M7: each capture with its photo, date, progress and three ways to get it out — "Send photo" (the
 *  JPEG as an image), "Send as zip" (the exact signed bytes, e.g. to WhatsApp) and "Share proof" (the
 *  .sakshi.json proof file). Pull down to sync with the server now. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CaptureListScreen(
    captures: List<CaptureEntity>,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onSendPhoto: (CaptureEntity, asFile: Boolean) -> Unit,
    onShare: (CaptureEntity) -> Unit,
) {
    PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize()) {
            item { SendHint() }
            if (captures.isEmpty()) {
                item {
                    Text(
                        "No captures yet. Take a photo on the Capture tab, then pull down here to refresh.",
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(32.dp),
                    )
                }
            }
            items(captures, key = { it.localId }) { capture ->
                CaptureRow(capture, onSendPhoto, onShare)
                HorizontalDivider()
            }
        }
    }
}

/** The question people actually asked: which button keeps the photo provably authentic. */
@Composable
private fun SendHint() {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        modifier = Modifier.fillMaxWidth().padding(16.dp),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Sending a photo", style = MaterialTheme.typography.titleSmall)
            Text(
                "Send as zip: the exact original. The recipient unzips it and the verifier says AUTHENTIC.",
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                "Send photo: quick to view, but apps like WhatsApp recompress it, so the verifier can only say " +
                    "SIMILAR TO AUTHENTIC.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun CaptureRow(capture: CaptureEntity, onSendPhoto: (CaptureEntity, Boolean) -> Unit, onShare: (CaptureEntity) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Thumbnail(capture.photoFilePath)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.weight(1f)) {
                Text(formatCapturedAt(capture.capturedAt, capture.createdAtEpochMs), style = MaterialTheme.typography.titleMedium)
                Text(
                    "SHA-256 " + capture.sha256Hex.take(16) + "…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        StepTrack(capture.status)
        capture.lastError?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            // Any status: the verifier looks the proof up by the photo's hash at verification time,
            // so the photo can go out before it is anchored.
            OutlinedButton(onClick = { onSendPhoto(capture, false) }, modifier = Modifier.weight(1f)) { Text("Send photo") }
            // Zipped so WhatsApp delivers the exact bytes (it recompresses anything it sees as an image).
            Button(onClick = { onSendPhoto(capture, true) }, modifier = Modifier.weight(1f)) { Text("Send as zip") }
        }
        OutlinedButton(
            onClick = { onShare(capture) },
            enabled = capture.status == CaptureStatus.FINALIZED,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (capture.status == CaptureStatus.FINALIZED) "Share proof" else "Share proof (available once verified on-chain)")
        }
    }
}

private const val THUMB_DP = 72

@Composable
private fun Thumbnail(path: String) {
    val bitmap: Bitmap? by produceState<Bitmap?>(initialValue = null, path) {
        value = withContext(Dispatchers.IO) { ImageDecode.thumbnail(path, targetPx = 256) }
    }
    val shape = RoundedCornerShape(8.dp)
    Box(
        Modifier.size(THUMB_DP.dp).clip(shape).background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        bitmap?.let {
            Image(it.asImageBitmap(), contentDescription = "Captured photo", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } ?: Text("No photo", style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center)
    }
}

/** Four segments (Signed, Uploaded, Anchored, Verified on-chain) plus a line saying where it is now. */
@Composable
private fun StepTrack(status: CaptureStatus) {
    val done = completedSteps(status)
    if (done == null) {
        Text("Couldn't be anchored", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.error)
        return
    }
    val description = "Step $done of ${CAPTURE_STEPS.size}: ${CAPTURE_STEPS[done - 1]}"
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.semantics { contentDescription = description }) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
            CAPTURE_STEPS.forEachIndexed { i, _ ->
                Box(
                    Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(3.dp)).background(
                        if (i < done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                    ),
                )
            }
        }
        Row(Modifier.fillMaxWidth()) {
            CAPTURE_STEPS.forEachIndexed { i, label ->
                Text(
                    label,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (i < done) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        Text(nextStepNote(status), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun nextStepNote(status: CaptureStatus): String = when (status) {
    CaptureStatus.SIGNED, CaptureStatus.QUEUED -> "Signed on this phone. Uploads when the server is reachable."
    CaptureStatus.PENDING -> "Uploaded. Waiting for the next batch to be anchored on-chain."
    CaptureStatus.SUBMITTED -> "Anchoring transaction sent, waiting for it to be mined."
    CaptureStatus.CONFIRMED -> "Anchored on-chain. Waiting for the block to become final."
    CaptureStatus.FINALIZED -> "Verified on-chain. This photo checks out as AUTHENTIC."
    CaptureStatus.FAILED -> ""
}

/** The manifest's signed capture time, in the phone's local zone; falls back to when the row was
 *  created if that string ever fails to parse, so a capture never shows up without a date. */
internal fun formatCapturedAt(
    capturedAt: String,
    createdAtEpochMs: Long,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
): String {
    val instant = runCatching { OffsetDateTime.parse(capturedAt).toInstant() }
        .getOrElse { Instant.ofEpochMilli(createdAtEpochMs) }
    return DateTimeFormatter.ofPattern("dd MMM yyyy, hh:mm:ss a", locale).withZone(zone).format(instant)
}
