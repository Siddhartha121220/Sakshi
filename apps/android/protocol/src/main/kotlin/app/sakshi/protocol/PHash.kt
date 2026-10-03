package app.sakshi.protocol

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sqrt

/**
 * Perceptual hashing: docs/PROTOCOL.md §5, mirroring packages/core/src/phash.ts exactly (box
 * downscale, 2D DCT-II, median threshold). Pure pixel math only, no image-codec dependency — image
 * decoding (and EXIF orientation) is the caller's job, same split as the TypeScript side.
 *
 * The 64-bit hash is represented as a Kotlin `Long`: its two's-complement bit pattern is identical
 * to the "unsigned 64-bit" value the protocol defines and to the signed BIGINT column it's stored
 * in (docs/DATABASE.md §3.5) — `java.lang.Long`'s *Unsigned* helpers handle the hex <-> Long
 * conversion without any manual sign-juggling.
 */
object PHash {
    private const val MIN_HASHABLE_DIMENSION = 64

    data class RgbImage(val width: Int, val height: Int, val rgb: ByteArray)

    fun isHashable(width: Int, height: Int): Boolean =
        width >= MIN_HASHABLE_DIMENSION && height >= MIN_HASHABLE_DIMENSION

    fun toLuma(image: RgbImage): DoubleArray {
        val luma = DoubleArray(image.width * image.height)
        for (i in luma.indices) {
            val r = image.rgb[i * 3].toInt() and 0xFF
            val g = image.rgb[i * 3 + 1].toInt() and 0xFF
            val b = image.rgb[i * 3 + 2].toInt() and 0xFF
            luma[i] = 0.299 * r + 0.587 * g + 0.114 * b
        }
        return luma
    }

    /** Box-filter downscale — docs/PROTOCOL.md §5.0. Deliberately not a platform scaler
     *  (Bitmap.createScaledBitmap differs from browser canvas scaling); must match packages/core. */
    fun boxDownscale(src: DoubleArray, srcW: Int, srcH: Int, dstW: Int, dstH: Int): DoubleArray {
        val out = DoubleArray(dstW * dstH)
        for (y in 0 until dstH) {
            val sy0 = (y * srcH) / dstH
            val sy1 = maxOf(sy0 + 1, ((y + 1) * srcH) / dstH)
            for (x in 0 until dstW) {
                val sx0 = (x * srcW) / dstW
                val sx1 = maxOf(sx0 + 1, ((x + 1) * srcW) / dstW)
                var sum = 0.0
                var count = 0
                for (sy in sy0 until minOf(sy1, srcH)) {
                    for (sx in sx0 until minOf(sx1, srcW)) {
                        sum += src[sy * srcW + sx]
                        count++
                    }
                }
                out[y * dstW + x] = if (count > 0) sum / count else 0.0
            }
        }
        return out
    }

    private fun dct1d(x: DoubleArray): DoubleArray {
        val n = x.size
        val out = DoubleArray(n)
        for (k in 0 until n) {
            var sum = 0.0
            for (i in 0 until n) {
                sum += x[i] * cos((PI / n) * (i + 0.5) * k)
            }
            out[k] = (if (k == 0) sqrt(1.0 / n) else sqrt(2.0 / n)) * sum
        }
        return out
    }

    private fun dct2d(block: DoubleArray, n: Int): DoubleArray {
        val afterRows = DoubleArray(n * n)
        for (r in 0 until n) {
            val row = block.copyOfRange(r * n, (r + 1) * n)
            dct1d(row).copyInto(afterRows, r * n)
        }
        val out = DoubleArray(n * n)
        val col = DoubleArray(n)
        for (c in 0 until n) {
            for (r in 0 until n) col[r] = afterRows[r * n + c]
            val transformed = dct1d(col)
            for (r in 0 until n) out[r * n + c] = transformed[r]
        }
        return out
    }

    /** Packs bits where bits[0] is the most significant bit (docs/PROTOCOL.md §5.1/§5.2). */
    private fun packBitsMsbFirst(bits: BooleanArray): Long {
        var value = 0L
        for (i in bits.indices) {
            if (bits[i]) value = value or (1L shl (bits.size - 1 - i))
        }
        return value
    }

    private fun median(values: DoubleArray): Double {
        val sorted = values.sorted()
        val mid = sorted.size / 2
        return if (sorted.size % 2 == 0) (sorted[mid - 1] + sorted[mid]) / 2.0 else sorted[mid]
    }

    /** The 64-bit global perceptual hash (docs/PROTOCOL.md §5.1). */
    fun computeGlobalPHash(luma: DoubleArray, width: Int, height: Int): Long {
        val small = boxDownscale(luma, width, height, 32, 32)
        val dct = dct2d(small, 32)

        val low = DoubleArray(64) // top-left 8x8 low-frequency block, row-major (u, v)
        for (u in 0 until 8) {
            for (v in 0 until 8) {
                low[u * 8 + v] = dct[u * 32 + v]
            }
        }

        val m = median(low)
        val bits = BooleanArray(64)
        for (u in 0 until 8) {
            for (v in 0 until 8) {
                bits[u * 8 + v] = low[u * 8 + v] > m
            }
        }
        return packBitsMsbFirst(bits)
    }

    /** The 16 per-tile 64-bit dHashes (docs/PROTOCOL.md §5.2), for localising edits. Returns 128
     *  bytes: 16 tiles x 8 bytes, big-endian, row-major tile order — matches the DB's tile_hashes
     *  column and packages/core's computeTileHashes(). */
    fun computeTileHashes(luma: DoubleArray, width: Int, height: Int): ByteArray {
        val out = ByteArray(16 * 8)
        for (tr in 0 until 4) {
            val y0 = (tr * height) / 4
            val y1 = ((tr + 1) * height) / 4
            for (tc in 0 until 4) {
                val x0 = (tc * width) / 4
                val x1 = ((tc + 1) * width) / 4
                val tileW = x1 - x0
                val tileH = y1 - y0

                val tile = DoubleArray(tileW * tileH)
                for (y in 0 until tileH) {
                    for (x in 0 until tileW) {
                        tile[y * tileW + x] = luma[(y0 + y) * width + (x0 + x)]
                    }
                }

                val small = boxDownscale(tile, tileW, tileH, 9, 8) // 9 wide x 8 tall, per §5.2
                val bits = BooleanArray(64)
                for (row in 0 until 8) {
                    for (col in 0 until 8) {
                        bits[row * 8 + col] = small[row * 9 + col] < small[row * 9 + col + 1]
                    }
                }
                val hash = packBitsMsbFirst(bits)
                val tileIndex = tr * 4 + tc
                for (b in 0 until 8) {
                    out[tileIndex * 8 + b] = ((hash ushr (8 * (7 - b))) and 0xFF).toByte()
                }
            }
        }
        return out
    }

    fun hammingDistance(a: Long, b: Long): Int = java.lang.Long.bitCount(a xor b)

    fun phashToHex(hash: Long): String = java.lang.Long.toHexString(hash).padStart(16, '0')

    fun phashFromHex(hex: String): Long = java.lang.Long.parseUnsignedLong(hex, 16)
}
