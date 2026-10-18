package app.sakshi.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.sakshi.android.network.normalizeServerUrl

/** Server address (so the phone can reach a laptop over Wi-Fi, a tunnel, or a hosted API without a
 *  rebuild), a connection test, and the device registration state. */
@Composable
fun SettingsScreen(
    serverUrl: String,
    defaultServerUrl: String,
    registration: RegistrationState,
    onSave: (String) -> String?,
    onReset: () -> Unit,
    onTestConnection: ((String) -> Unit) -> Unit,
    onRetryRegistration: () -> Unit,
    countUnsubmitted: ((Int) -> Unit) -> Unit,
) {
    var draft by remember(serverUrl) { mutableStateOf(serverUrl) }
    var fieldError by remember { mutableStateOf<String?>(null) }
    var testResult by remember { mutableStateOf<String?>(null) }
    var pendingConfirm by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(serverUrl) { testResult = null }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Server", style = MaterialTheme.typography.titleLarge)
        Text(
            "Where this phone sends signed photo records. Use your laptop's address on the same Wi-Fi " +
                "(e.g. 192.168.1.5:3000), 127.0.0.1:3000 over USB with adb reverse, or a hosted https:// URL.",
            style = MaterialTheme.typography.bodyMedium,
        )
        OutlinedTextField(
            value = draft,
            onValueChange = { draft = it; fieldError = null },
            label = { Text("Server address") },
            singleLine = true,
            isError = fieldError != null,
            supportingText = { Text(fieldError ?: "Default: $defaultServerUrl") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Button(
                onClick = {
                    if (normalizeServerUrl(draft) == null) {
                        fieldError = "Not a valid server address. Use host:port (e.g. 192.168.1.5:3000) or a full https:// URL."
                    } else {
                        countUnsubmitted { pendingConfirm = it }
                    }
                },
                enabled = draft.trim().trimEnd('/') != serverUrl,
                modifier = Modifier.weight(1f),
            ) { Text("Save") }
            OutlinedButton(onClick = { onTestConnection { testResult = it } }, modifier = Modifier.weight(1f)) {
                Text("Test connection")
            }
        }
        TextButton(onClick = onReset, enabled = serverUrl != defaultServerUrl) { Text("Reset to default") }
        testResult?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }

        Text("Device", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 12.dp))
        when (registration) {
            RegistrationState.Checking -> Text("Registering this phone with the server…")
            RegistrationState.Registered -> Text("Registered — this phone's hardware key is known to the server.")
            is RegistrationState.Failed -> {
                Text("Not registered: ${registration.message}", color = MaterialTheme.colorScheme.error)
                Button(onClick = onRetryRegistration) { Text("Retry registration") }
            }
        }
    }

    pendingConfirm?.let { unsubmitted ->
        AlertDialog(
            onDismissRequest = { pendingConfirm = null },
            title = { Text("Switch server?") },
            text = {
                Text(
                    "This phone will register with the new server using a new hardware key." +
                        if (unsubmitted > 0) {
                            " $unsubmitted photo(s) not yet uploaded were signed for the old registration and will be " +
                                "marked failed (they stay in your gallery)."
                        } else {
                            ""
                        },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    pendingConfirm = null
                    fieldError = onSave(draft)
                }) { Text("Switch") }
            },
            dismissButton = { TextButton(onClick = { pendingConfirm = null }) { Text("Cancel") } },
        )
    }
}
