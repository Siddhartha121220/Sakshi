package app.sakshi.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.security.SecureRandom
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** Golden-vector test against packages/core/test-vectors/signature-encoding.json. */
class SignatureTest {
    private fun loadVectors(): List<Triple<String, String, String>> {
        val text = javaClass.classLoader.getResourceAsStream("signature-encoding.json")!!.bufferedReader().readText()
        val array = Json.parseToJsonElement(text) as JsonArray
        return array.map { item ->
            val obj = item as JsonObject
            Triple(
                (obj["name"] as JsonPrimitive).content,
                (obj["rawHex"] as JsonPrimitive).content,
                (obj["derHex"] as JsonPrimitive).content,
            )
        }
    }

    @Test
    fun `rawToDerSignature matches every golden vector`() {
        for ((name, rawHex, derHex) in loadVectors()) {
            assertEquals(derHex, rawToDerSignature(hexToBytes(rawHex)).toHex(), "mismatch for '$name'")
        }
    }

    @Test
    fun `derToRawSignature matches every golden vector`() {
        for ((name, rawHex, derHex) in loadVectors()) {
            assertEquals(rawHex, derToRawSignature(hexToBytes(derHex)).toHex(), "mismatch for '$name'")
        }
    }

    @Test
    fun `round-trips raw to DER to raw for random coordinates`() {
        val random = SecureRandom()
        repeat(50) {
            val raw = ByteArray(64).also { random.nextBytes(it) }
            assertEquals(raw.toHex(), derToRawSignature(rawToDerSignature(raw)).toHex())
        }
    }

    @Test
    fun `rejects a DER blob with the wrong leading tag`() {
        assertFailsWith<IllegalArgumentException> { derToRawSignature(hexToBytes("310001")) }
    }

    @Test
    fun `rejects a raw signature of the wrong length`() {
        assertFailsWith<IllegalArgumentException> { rawToDerSignature(ByteArray(63)) }
    }

    @Test
    fun `end-to-end sign and verify against WebCrypto-compatible P-256`() {
        val keyPair = generateP256KeyPairForTest()
        val data = "the manifest bytes".toByteArray()

        val der = signP256AsDerForTest(keyPair.private, data)

        assertTrue(verifyP256Signature(keyPair.public.encoded, data, der))
    }

    @Test
    fun `rejects a signature over different bytes`() {
        val keyPair = generateP256KeyPairForTest()
        val der = signP256AsDerForTest(keyPair.private, "original".toByteArray())
        assertTrue(!verifyP256Signature(keyPair.public.encoded, "tampered".toByteArray(), der))
    }

    @Test
    fun `rejects a signature from a different key`() {
        val real = generateP256KeyPairForTest()
        val attacker = generateP256KeyPairForTest()
        val data = "the manifest bytes".toByteArray()
        val derFromAttacker = signP256AsDerForTest(attacker.private, data)
        assertTrue(!verifyP256Signature(real.public.encoded, data, derFromAttacker))
    }
}
