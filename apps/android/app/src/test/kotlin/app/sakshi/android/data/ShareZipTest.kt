package app.sakshi.android.data

import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.zip.ZipFile
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals

// "Send as zip" exists only to deliver the signed bytes untouched: if a single byte of the JPEG changed
// on its way into the archive, the recipient's verifier would fall back from AUTHENTIC to SIMILAR.
class ShareZipTest {
    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)

    @Test
    fun `zip holds exactly one entry whose bytes are identical to the photo`() {
        val dir = Files.createTempDirectory("sharezip").toFile()
        val photo = File(dir, "sakshi-capture-1791356956371.jpg")
        // Incompressible random bytes plus a JPEG-like header: exercises the deflate path on data that
        // doesn't shrink, which is what a real camera JPEG looks like to zip.
        val original = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte()) + Random(42).nextBytes(256 * 1024)
        photo.writeBytes(original)

        val zip = createShareZip(File(dir, "shared"), photo)

        assertEquals("sakshi-capture-1791356956371.zip", zip.name)
        ZipFile(zip).use { zf ->
            val entries = zf.entries().toList()
            assertEquals(listOf(photo.name), entries.map { it.name })
            val unzipped = zf.getInputStream(entries.single()).readBytes()
            assertContentEquals(original, unzipped)
            assertContentEquals(sha256(original), sha256(unzipped))
        }
    }

    @Test
    fun `sharing the same photo twice overwrites rather than appending a second entry`() {
        val dir = Files.createTempDirectory("sharezip").toFile()
        val photo = File(dir, "a.jpg").apply { writeBytes(Random(1).nextBytes(1024)) }

        createShareZip(File(dir, "shared"), photo)
        val zip = createShareZip(File(dir, "shared"), photo)

        ZipFile(zip).use { assertEquals(1, it.size()) }
    }
}
