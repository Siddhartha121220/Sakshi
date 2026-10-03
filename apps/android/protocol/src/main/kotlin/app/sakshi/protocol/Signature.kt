package app.sakshi.protocol

import java.security.KeyPairGenerator
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.security.KeyFactory

// Mirrors packages/core/src/signature.ts. Android Keystore signs with SHA256withECDSA and already
// emits ASN.1 DER natively (SEQUENCE { INTEGER r, INTEGER s }) — unlike the web verifier (WebCrypto,
// which only speaks raw r‖s), the Android app never needs to CONVERT a signature to send it. This
// DER<->raw conversion exists here anyway so the app can produce/consume the same encoding the rest
// of the protocol uses, and so this logic is tested against the shared signature-encoding vectors.

private const val P256_COORD_LEN = 32

private fun readDerLength(der: ByteArray, offset: Int): Pair<Int, Int> {
    val first = der[offset].toInt() and 0xFF
    if (first and 0x80 == 0) return first to (offset + 1)
    val numBytes = first and 0x7F
    require(numBytes in 1..4) { "malformed DER: unsupported length encoding" }
    var length = 0
    for (i in 0 until numBytes) {
        length = (length shl 8) or (der[offset + 1 + i].toInt() and 0xFF)
    }
    return length to (offset + 1 + numBytes)
}

private fun readDerInteger(der: ByteArray, offset: Int): Pair<ByteArray, Int> {
    require(der[offset] == 0x02.toByte()) { "malformed DER: expected INTEGER tag" }
    val (length, contentStart) = readDerLength(der, offset + 1)
    val value = der.copyOfRange(contentStart, contentStart + length)
    return value to (contentStart + length)
}

private fun derIntegerToFixedWidth(bytes: ByteArray): ByteArray {
    var start = 0
    while (start < bytes.size - 1 && bytes[start] == 0.toByte()) start++
    val trimmed = bytes.copyOfRange(start, bytes.size)
    require(trimmed.size <= P256_COORD_LEN) { "malformed DER: integer too large for P-256" }
    val out = ByteArray(P256_COORD_LEN)
    trimmed.copyInto(out, P256_COORD_LEN - trimmed.size)
    return out
}

private fun fixedWidthToDerInteger(coord: ByteArray): ByteArray {
    var start = 0
    while (start < coord.size - 1 && coord[start] == 0.toByte()) start++
    var trimmed = coord.copyOfRange(start, coord.size)
    if (trimmed[0].toInt() and 0x80 != 0) {
        trimmed = byteArrayOf(0) + trimmed
    }
    return byteArrayOf(0x02, trimmed.size.toByte()) + trimmed
}

/** DER (Android Keystore's native format) -> raw r‖s (64 bytes, WebCrypto's format). */
fun derToRawSignature(der: ByteArray): ByteArray {
    require(der[0] == 0x30.toByte()) { "malformed DER: expected SEQUENCE tag" }
    val (_, contentStart) = readDerLength(der, 1)
    val (rBytes, afterR) = readDerInteger(der, contentStart)
    val (sBytes, _) = readDerInteger(der, afterR)
    return derIntegerToFixedWidth(rBytes) + derIntegerToFixedWidth(sBytes)
}

/** Raw r‖s (64 bytes) -> DER (Android Keystore's native format). */
fun rawToDerSignature(raw: ByteArray): ByteArray {
    require(raw.size == 2 * P256_COORD_LEN) { "raw signature must be ${2 * P256_COORD_LEN} bytes" }
    val r = fixedWidthToDerInteger(raw.copyOfRange(0, P256_COORD_LEN))
    val s = fixedWidthToDerInteger(raw.copyOfRange(P256_COORD_LEN, raw.size))
    val content = r + s
    return byteArrayOf(0x30, content.size.toByte()) + content
}

/** Verifies a DER-encoded ECDSA P-256 signature over `data` (docs/PROTOCOL.md §8 step 5). */
fun verifyP256Signature(publicKeySpki: ByteArray, data: ByteArray, signatureDer: ByteArray): Boolean {
    val publicKey: PublicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(publicKeySpki))
    val verifier = Signature.getInstance("SHA256withECDSA")
    verifier.initVerify(publicKey)
    verifier.update(data)
    return verifier.verify(signatureDer) // java.security.Signature speaks DER natively
}

/** Generates a P-256 keypair, for tests (simulating a device's hardware key without Keystore). */
fun generateP256KeyPairForTest(): java.security.KeyPair {
    val generator = KeyPairGenerator.getInstance("EC")
    generator.initialize(java.security.spec.ECGenParameterSpec("secp256r1"))
    return generator.generateKeyPair()
}

/** Signs `data` with a plain java.security key, for tests — Android Keystore signing lives in the
 *  `app` module (it needs a real Keystore-backed key, which the JVM doesn't have). */
fun signP256AsDerForTest(privateKey: java.security.PrivateKey, data: ByteArray): ByteArray {
    val signer = Signature.getInstance("SHA256withECDSA")
    signer.initSign(privateKey)
    signer.update(data)
    return signer.sign() // already DER
}
