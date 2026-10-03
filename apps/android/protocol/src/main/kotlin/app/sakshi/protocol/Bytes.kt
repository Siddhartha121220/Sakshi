package app.sakshi.protocol

import java.util.Base64

// Mirrors packages/core/src/bytes.ts. Two hex conventions (docs/PROTOCOL.md §1): plain lowercase
// hex (no 0x) for hashes/keys, and "0x"-prefixed hex for EVM values.

fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

fun hexToBytes(hex: String): ByteArray {
    val clean = if (hex.startsWith("0x") || hex.startsWith("0X")) hex.substring(2) else hex
    require(clean.length % 2 == 0) { "invalid hex string: $hex" }
    return ByteArray(clean.length / 2) { i ->
        clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
}

fun ByteArray.toHex0x(): String = "0x" + toHex()

fun ByteArray.toBase64(): String = Base64.getEncoder().encodeToString(this)

fun base64ToBytes(b64: String): ByteArray = Base64.getDecoder().decode(b64)
