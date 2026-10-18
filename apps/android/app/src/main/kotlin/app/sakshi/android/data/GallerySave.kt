package app.sakshi.android.data

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File

/**
 * Copies the signed JPEG into the phone's gallery (Pictures/Sakshi) byte-for-byte, so the photo
 * survives the app's private storage being cleared. This is export only: nothing ever reads the
 * gallery back, so invariant #5 (no gallery import) is untouched — the signature still covers the
 * app-private original, and a gallery copy that gets edited is simply a different, unsigned file.
 *
 * Needs no permission on Android 10+ (scoped storage). On 9 (minSdk is 28) writing there would need
 * WRITE_EXTERNAL_STORAGE, which isn't worth a permission prompt for a convenience copy, so it's
 * skipped and the photo stays app-private only.
 */
fun saveToGallery(context: Context, photo: File): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false

    val resolver = context.contentResolver
    val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, photo.name)
        put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
        put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Sakshi")
        put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
    return try {
        resolver.openOutputStream(uri)!!.use { out -> photo.inputStream().use { it.copyTo(out) } }
        values.clear()
        values.put(MediaStore.MediaColumns.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        true
    } catch (e: Exception) {
        resolver.delete(uri, null, null) // don't leave a half-written entry visible in the gallery
        false
    }
}
