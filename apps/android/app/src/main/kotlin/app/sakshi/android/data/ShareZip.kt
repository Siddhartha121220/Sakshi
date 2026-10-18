package app.sakshi.android.data

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Wraps the signed JPEG in a zip so it can be sent without being touched. Messaging apps like WhatsApp
 * recompress and strip anything they recognise as an image — which changes the bytes the signature
 * covers — but always deliver a zip as an opaque document. (Setting a generic MIME type on the share
 * intent did NOT work: WhatsApp still sent a 1.1 MB capture as a 75 KB image, most likely because it
 * asks the FileProvider for the type, which derives image/jpeg from the ".jpg" extension.)
 * The entry keeps the original file name, and the JPEG's bytes are copied verbatim.
 */
fun createShareZip(outDir: File, photo: File): File {
    outDir.mkdirs()
    val zip = File(outDir, "${photo.nameWithoutExtension}.zip")
    ZipOutputStream(zip.outputStream()).use { out ->
        out.putNextEntry(ZipEntry(photo.name))
        photo.inputStream().use { it.copyTo(out) }
        out.closeEntry()
    }
    return zip
}
