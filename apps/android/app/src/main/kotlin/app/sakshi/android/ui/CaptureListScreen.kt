package app.sakshi.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import app.sakshi.android.data.CaptureEntity
import app.sakshi.android.data.CaptureStatus
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** FR-M7: per-capture status plus three ways to get it out — "Send photo" (the JPEG as an image),
 *  "Send as zip" (the exact signed bytes, e.g. to WhatsApp) and "Share proof" (the .sakshi.json proof file). */
@Composable
fun CaptureListScreen(captures: List<CaptureEntity>, onSendPhoto: (CaptureEntity, asFile: Boolean) -> Unit, onShare: (CaptureEntity) -> Unit) {
    if (captures.isEmpty()) {
        Text("No captures yet.", modifier = Modifier.padding(16.dp))
        return
    }
    LazyColumn(Modifier.fillMaxWidth()) {
        items(captures, key = { it.localId }) { capture ->
            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(formatCapturedAt(capture.capturedAt, capture.createdAtEpochMs), style = MaterialTheme.typography.titleMedium)
                Text(capture.sha256Hex.take(16) + "…", style = MaterialTheme.typography.bodySmall)
                Text(statusLabel(capture.status))
                capture.lastError?.let { Text("Last error: $it", color = Color.Red) }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    // Any status: the verifier looks the proof up by the photo's hash at verification time,
                    // so the photo can go out before it is anchored.
                    Button(onClick = { onSendPhoto(capture, false) }, modifier = Modifier.weight(1f)) { Text("Send photo") }
                    // Zipped so WhatsApp delivers the exact bytes (it recompresses anything it sees as an image) — the
                    // recipient unzips, and their verifier can then say AUTHENTIC rather than only "similar".
                    Button(onClick = { onSendPhoto(capture, true) }, modifier = Modifier.weight(1f)) { Text("Send as zip") }
                }
                Button(
                    onClick = { onShare(capture) },
                    enabled = capture.status == CaptureStatus.FINALIZED,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (capture.status == CaptureStatus.FINALIZED) "Share proof" else "Share proof (available once finalized)")
                }
            }
            HorizontalDivider()
        }
    }
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

private fun statusLabel(status: CaptureStatus): String = when (status) {
    CaptureStatus.SIGNED, CaptureStatus.QUEUED -> "Signed — waiting to upload"
    CaptureStatus.PENDING -> "Uploaded — waiting to be anchored"
    CaptureStatus.SUBMITTED -> "Anchoring…"
    CaptureStatus.CONFIRMED -> "Anchored — waiting for finality"
    CaptureStatus.FINALIZED -> "✅ Finalized"
    CaptureStatus.FAILED -> "❌ Failed"
}
