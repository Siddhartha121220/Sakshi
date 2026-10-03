package app.sakshi.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val DarkColors = darkColorScheme(primary = androidx.compose.ui.graphics.Color(0xFF4F8CFF))
private val LightColors = lightColorScheme(primary = androidx.compose.ui.graphics.Color(0xFF2B6CFF))

@Composable
fun SakshiTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors, content = content)
}
