package app.sakshi.android.keystore

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature

/**
 * Android Keystore key generation and signing — docs/PROTOCOL.md §2.2, docs/ARCHITECTURE.md §2.1.
 *
 * **Not yet verified against real hardware** (docs/ROADMAP.md Phase 0's spike is still
 * outstanding) — this follows the documented Keystore API precisely, but OEM StrongBox/TEE
 * quirks are a known real-world risk (see docs/THREAT_MODEL.md T6) that only a real device run
 * can surface. See apps/android/app/README.md.
 */
class DeviceKeyManager {
    companion object {
        private const val ALIAS = "sakshi-device-key-v1"
        private const val PROVIDER = "AndroidKeyStore"
    }

    enum class SecurityLevel { STRONGBOX, TEE }

    data class GeneratedKey(
        val publicKeySpki: ByteArray,
        val attestationChainDer: List<ByteArray>, // leaf first
        val securityLevel: SecurityLevel,
    )

    private val keyStore: KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

    fun hasExistingKey(): Boolean = keyStore.containsAlias(ALIAS)

    fun existingPublicKeySpki(): ByteArray? =
        if (hasExistingKey()) keyStore.getCertificate(ALIAS).publicKey.encoded else null

    /**
     * Generates the device's signing key with the given attestation challenge embedded
     * (docs/PROTOCOL.md §2.2 — the raw 40 bytes from the server's issued challenge, not the
     * base64url string). Tries StrongBox first, falling back to the TEE if unavailable.
     */
    fun generateKey(challengeBytes: ByteArray): GeneratedKey {
        val (chain, securityLevel) = tryGenerate(challengeBytes, strongBox = true)
            ?: tryGenerate(challengeBytes, strongBox = false)
            ?: throw IllegalStateException("key generation failed on both StrongBox and TEE")

        val publicKeySpki = keyStore.getCertificate(ALIAS).publicKey.encoded
        return GeneratedKey(publicKeySpki, chain, securityLevel)
    }

    private fun tryGenerate(challengeBytes: ByteArray, strongBox: Boolean): Pair<List<ByteArray>, SecurityLevel>? {
        return try {
            val specBuilder = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setAttestationChallenge(challengeBytes)
            if (strongBox) specBuilder.setIsStrongBoxBacked(true)

            val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER)
            generator.initialize(specBuilder.build())
            generator.generateKeyPair()

            val chain = keyStore.getCertificateChain(ALIAS).map { it.encoded }
            val level = if (strongBox) SecurityLevel.STRONGBOX else actualSecurityLevel()
            chain to level
        } catch (e: StrongBoxUnavailableException) {
            null
        }
    }

    private fun actualSecurityLevel(): SecurityLevel {
        val privateKey = keyStore.getKey(ALIAS, null) as PrivateKey
        val factory = KeyFactory.getInstance(privateKey.algorithm, PROVIDER)
        val keyInfo = factory.getKeySpec(privateKey, KeyInfo::class.java)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && keyInfo.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX) {
            SecurityLevel.STRONGBOX
        } else {
            SecurityLevel.TEE
        }
    }

    /** Signs `data` with the device key, returning a DER-encoded ECDSA signature (the format the
     *  rest of the protocol expects — docs/PROTOCOL.md §1; Keystore emits this natively). */
    fun sign(data: ByteArray): ByteArray {
        val privateKey = keyStore.getKey(ALIAS, null) as PrivateKey
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey)
        signer.update(data)
        return signer.sign()
    }
}
