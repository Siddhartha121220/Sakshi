package app.sakshi.protocol

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Golden-vector test against packages/core/test-vectors/jcs.json — the cross-language contract
 *  (CONTRIBUTING.md invariant #8). If this fails, Kotlin and TypeScript disagree on canonical bytes. */
class JcsTest {
    private data class Vector(val name: String, val canonicalUtf8Hex: String)

    private val json = Json { ignoreUnknownKeys = true }

    private fun loadVectors(): List<Pair<Vector, kotlinx.serialization.json.JsonElement>> {
        val text = javaClass.classLoader.getResourceAsStream("jcs.json")!!.bufferedReader().readText()
        val array = json.parseToJsonElement(text).let { it as kotlinx.serialization.json.JsonArray }
        return array.map { item ->
            val obj = item as kotlinx.serialization.json.JsonObject
            val name = (obj["name"] as kotlinx.serialization.json.JsonPrimitive).content
            val hex = (obj["canonicalUtf8Hex"] as kotlinx.serialization.json.JsonPrimitive).content
            Vector(name, hex) to obj["input"]!!
        }
    }

    @Test
    fun `matches every golden vector`() {
        for ((vector, input) in loadVectors()) {
            val actual = jcsEncode(input).toByteArray(Charsets.UTF_8).toHex()
            assertEquals(vector.canonicalUtf8Hex, actual, "mismatch for vector '${vector.name}'")
        }
    }

    @Test
    fun `sorts object keys lexicographically`() {
        val obj = json.parseToJsonElement("""{"b":1,"a":2}""")
        assertEquals("""{"a":2,"b":1}""", jcsEncode(obj))
    }

    @Test
    fun `produces no whitespace`() {
        val obj = json.parseToJsonElement("""{"a": [1, 2], "b": {"c": 3}}""")
        assertEquals("""{"a":[1,2],"b":{"c":3}}""", jcsEncode(obj))
    }

    @Test
    fun `isCanonicalJcs accepts its own output`() {
        val bytes = jcsEncode(json.parseToJsonElement("""{"z":1,"a":2}""")).toByteArray(Charsets.UTF_8)
        assertTrue(isCanonicalJcs(bytes) { json.parseToJsonElement(it) })
    }

    @Test
    fun `isCanonicalJcs rejects non-canonical key order`() {
        val bytes = """{"z":1,"a":2}""".toByteArray(Charsets.UTF_8)
        assertFalse(isCanonicalJcs(bytes) { json.parseToJsonElement(it) })
    }

    @Test
    fun `isCanonicalJcs rejects whitespace`() {
        val bytes = """{"a": 1}""".toByteArray(Charsets.UTF_8)
        assertFalse(isCanonicalJcs(bytes) { json.parseToJsonElement(it) })
    }
}
