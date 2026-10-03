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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.sakshi.android.data.CaptureEntity
import app.sakshi.android.data.CaptureStatus

/** FR-M7: per-capture status, and "share as file" for the exported proof bundle. */
@Composable
fun CaptureListScreen(captures: List<CaptureEntity>, onShare: (CaptureEntity) -> Unit) {
    if (captures.isEmpty()) {
        Text("No captures yet.", modifier = Modifier.padding(16.dp))
        return
    }
    LazyColumn(Modifier.fillMaxWidth()) {
        items(captures, key = { it.localId }) { capture ->
            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                Text(capture.sha256Hex.take(16) + "…", style = androidx.compose.material3.MaterialTheme.typography.bodyMedium)
                Text(statusLabel(capture.status))
                capture.lastError?.let { Text("Last error: $it", color = androidx.compose.ui.graphics.Color.Red) }
                Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                    Button(onClick = { onShare(capture) }, enabled = capture.status == CaptureStatus.FINALIZED) {
                        Text("Share proof")
                    }
                }
            }
            HorizontalDivider()
        }
    }
}

private fun statusLabel(status: CaptureStatus): String = when (status) {
    CaptureStatus.SIGNED, CaptureStatus.QUEUED -> "Signed — waiting to upload"
    CaptureStatus.PENDING -> "Uploaded — waiting to be anchored"
    CaptureStatus.SUBMITTED -> "Anchoring…"
    CaptureStatus.CONFIRMED -> "Anchored — waiting for finality"
    CaptureStatus.FINALIZED -> "✅ Finalized"
    CaptureStatus.FAILED -> "❌ Failed"
}
