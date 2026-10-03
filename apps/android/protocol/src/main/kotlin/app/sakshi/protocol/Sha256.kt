package app.sakshi.protocol

import java.security.MessageDigest

// Mirrors packages/core/src/sha256.ts.
fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)

fun sha256Hex(data: ByteArray): String = sha256(data).toHex()
