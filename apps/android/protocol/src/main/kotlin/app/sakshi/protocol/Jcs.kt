package app.sakshi.protocol

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * JSON Canonicalization Scheme (RFC 8785), mirroring packages/core/src/jcs.ts — same byte output
 * required (CONTRIBUTING.md invariant #8; verified against packages/core/test-vectors/jcs.json).
 *
 * Object keys are sorted by UTF-16 code unit (Kotlin's default String comparison already does
 * this, matching JS's `<`). Numbers follow JS's formatting: a whole-valued double prints with no
 * decimal point (e.g. `1.0` -> `1`) since JS has only one number type — this module's own manifest
 * builder (Manifest.kt) never emits non-integers, so that's the only number case it needs to get
 * right; it isn't a from-scratch RFC 8785 number-formatter for arbitrary exotic values (packages/
 * core's TypeScript canonicalizer makes the same practical trade-off, via the `canonicalize` npm
 * package's reliance on JS's native formatting).
 */
fun jcsEncode(element: JsonElement): String = buildString { writeCanonical(element, this) }

private fun writeCanonical(element: JsonElement, out: StringBuilder) {
    when (element) {
        is JsonNull -> out.append("null")
        is JsonObject -> {
            out.append('{')
            element.entries.sortedBy { it.key }.forEachIndexed { i, (key, value) ->
                if (i > 0) out.append(',')
                writeJsonString(key, out)
                out.append(':')
                writeCanonical(value, out)
            }
            out.append('}')
        }
        is JsonArray -> {
            out.append('[')
            element.forEachIndexed { i, value ->
                if (i > 0) out.append(',')
                writeCanonical(value, out)
            }
            out.append(']')
        }
        is JsonPrimitive -> writePrimitive(element, out)
    }
}

private fun writePrimitive(primitive: JsonPrimitive, out: StringBuilder) {
    if (primitive.isString) {
        writeJsonString(primitive.content, out)
        return
    }
    primitive.booleanOrNull?.let {
        out.append(if (it) "true" else "false")
        return
    }
    out.append(formatNumber(primitive))
}

private fun formatNumber(primitive: JsonPrimitive): String {
    val raw = primitive.content
    val asDouble = primitive.doubleOrNull ?: return raw
    if (asDouble.isFinite() && asDouble == Math.floor(asDouble) && Math.abs(asDouble) < 1e15) {
        return asDouble.toLong().toString() // JS: a whole-valued number has no decimal point
    }
    return raw // already-integer literals (no '.' in source) pass through unchanged
}

/** Standard JSON string escaping (RFC 8785 / ECMA-404) — non-ASCII characters are NOT escaped,
 *  matching JS's JSON.stringify, which is why packages/core's "unicode" test vector stays literal. */
private fun writeJsonString(s: String, out: StringBuilder) {
    out.append('"')
    for (c in s) {
        when {
            c == '"' -> out.append("\\\"")
            c == '\\' -> out.append("\\\\")
            c == '\b' -> out.append("\\b")
            c == '\u000C' -> out.append("\\f")
            c == '\n' -> out.append("\\n")
            c == '\r' -> out.append("\\r")
            c == '\t' -> out.append("\\t")
            c.code < 0x20 -> out.append("\\u%04x".format(c.code))
            else -> out.append(c)
        }
    }
    out.append('"')
}

/** True iff `bytes` is exactly the canonical JCS encoding of its own parsed content
 *  (docs/PROTOCOL.md §8 step 3) — this module's app only ever produces canonical bytes, but
 *  keeping this check mirrors packages/core/src/jcs.ts for parity and future reuse. */
fun isCanonicalJcs(bytes: ByteArray, parse: (String) -> JsonElement): Boolean {
    val text = bytes.toString(Charsets.UTF_8)
    val parsed = try {
        parse(text)
    } catch (e: Exception) {
        return false
    }
    return jcsEncode(parsed).toByteArray(Charsets.UTF_8).contentEquals(bytes)
}
