package app.sakshi.android.camera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import app.sakshi.protocol.PHash
import java.io.ByteArrayInputStream

/** Decodes captured JPEG bytes to RGB pixels for PHash, applying EXIF orientation first
 *  (docs/PROTOCOL.md §5.0 steps 1-2) — the Android-specific counterpart of apps/web's
 *  image-decode.ts. Kept out of the `:protocol` module because it needs android.graphics. */
object ImageDecode {
    fun decode(jpegBytes: ByteArray): PHash.RgbImage {
        val rotation = ExifInterface(ByteArrayInputStream(jpegBytes))
            .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)

        val decoded = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size)
            ?: error("could not decode JPEG bytes")
        val oriented = applyExifOrientation(decoded, rotation)

        val width = oriented.width
        val height = oriented.height
        val pixels = IntArray(width * height)
        oriented.getPixels(pixels, 0, width, 0, 0, width, height)
        if (oriented !== decoded) decoded.recycle()

        val rgb = ByteArray(width * height * 3)
        for (i in pixels.indices) {
            val p = pixels[i]
            rgb[i * 3] = ((p shr 16) and 0xFF).toByte()
            rgb[i * 3 + 1] = ((p shr 8) and 0xFF).toByte()
            rgb[i * 3 + 2] = (p and 0xFF).toByte()
        }
        oriented.recycle()
        return PHash.RgbImage(width, height, rgb)
    }

    /** A small, correctly rotated preview of a capture for the list, or null if the file is gone or
     *  unreadable. Decodes at a reduced sample size: never the full 12-megapixel photo per row. */
    fun thumbnail(path: String, targetPx: Int): Bitmap? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val opts = BitmapFactory.Options().apply {
            inSampleSize = app.sakshi.android.ui.thumbnailSampleSize(bounds.outWidth, bounds.outHeight, targetPx)
        }
        val decoded = BitmapFactory.decodeFile(path, opts) ?: return null
        val orientation = ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        applyExifOrientation(decoded, orientation)
    }.getOrNull()

    private fun applyExifOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            else -> return bitmap // ORIENTATION_NORMAL / UNDEFINED — nothing to do
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
}
