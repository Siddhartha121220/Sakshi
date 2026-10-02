// Builds a synthetic 2-certificate Android Key Attestation chain (a fake "root" + a leaf carrying
// a real KeyDescription extension) so attestation.ts's parsing and chain-validation logic can be
// unit-tested without a real device. This does NOT chain to Google's real roots — tests inject
// the fake root via verifyAndroidAttestation's `trustedRootPems` override.
import "reflect-metadata";
import { X509Certificate, X509CertificateGenerator, Extension, cryptoProvider } from "@peculiar/x509";
import { AsnConvert, OctetString } from "@peculiar/asn1-schema";
import * as android from "@peculiar/asn1-android";
import { webcrypto } from "node:crypto";
import { generateP256KeyPair, exportSpki } from "@sakshi/core";

cryptoProvider.set(webcrypto as unknown as Crypto);

export interface SyntheticChainOptions {
  challengeBytes: Uint8Array;
  securityLevel?: android.SecurityLevel;
  deviceLocked?: boolean;
  verifiedBootState?: android.VerifiedBootState;
  packageName?: string;
  /** Lowercase hex sha256 digest(s) Android records for the app's signing cert. */
  signatureDigestsHex?: string[];
  omitRootOfTrust?: boolean;
  omitAttestationApplicationId?: boolean;
  omitKeyDescriptionExtension?: boolean;
}

export interface SyntheticChain {
  rootPem: string;
  /** Leaf first, as the device would submit it. */
  chainDer: Uint8Array[];
  devicePublicKeySpki: Uint8Array;
}

export async function buildSyntheticAttestationChain(opts: SyntheticChainOptions): Promise<SyntheticChain> {
  const rootKeys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const rootCert = await X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: "CN=Sakshi Test Root",
    notBefore: new Date(Date.now() - 86_400_000),
    notAfter: new Date(Date.now() + 86_400_000),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    keys: rootKeys as CryptoKeyPair,
  });

  const deviceKeyPair = await generateP256KeyPair();
  const devicePublicKeySpki = await exportSpki(deviceKeyPair.publicKey);

  const hardwareEnforced = new android.AuthorizationList({});
  if (!opts.omitRootOfTrust) {
    hardwareEnforced.rootOfTrust = new android.RootOfTrust({
      verifiedBootKey: new OctetString(Buffer.from("test-boot-key", "utf8")),
      deviceLocked: opts.deviceLocked ?? true,
      verifiedBootState: opts.verifiedBootState ?? android.VerifiedBootState.verified,
    });
  }
  if (!opts.omitAttestationApplicationId) {
    const appId = new android.AttestationApplicationId({
      packageInfos: [
        new android.AttestationPackageInfo({
          packageName: new OctetString(Buffer.from(opts.packageName ?? "app.sakshi", "utf8")),
          version: 1,
        }),
      ],
      signatureDigests: (opts.signatureDigestsHex ?? ["aa".repeat(32)]).map((hex) => new OctetString(Buffer.from(hex, "hex"))),
    });
    hardwareEnforced.attestationApplicationId = new OctetString(AsnConvert.serialize(appId));
  }

  const keyDescription = new android.KeyMintKeyDescription({
    attestationVersion: android.Version.keyMint3,
    attestationSecurityLevel: opts.securityLevel ?? android.SecurityLevel.trustedEnvironment,
    keyMintVersion: 300,
    keyMintSecurityLevel: opts.securityLevel ?? android.SecurityLevel.trustedEnvironment,
    attestationChallenge: new OctetString(Buffer.from(opts.challengeBytes)),
    uniqueId: new OctetString(new Uint8Array(0)),
    softwareEnforced: new android.AuthorizationList({}),
    hardwareEnforced,
  });
  const keyDescriptionExt = new Extension(android.id_ce_keyDescription, false, AsnConvert.serialize(keyDescription));

  const leafCert = await X509CertificateGenerator.create({
    serialNumber: "02",
    subject: "CN=Sakshi Test Device",
    issuer: rootCert.subject,
    notBefore: new Date(Date.now() - 3600_000),
    notAfter: new Date(Date.now() + 3600_000),
    signingKey: rootKeys.privateKey,
    publicKey: deviceKeyPair.publicKey,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    extensions: opts.omitKeyDescriptionExtension ? [] : [keyDescriptionExt],
  });

  return {
    rootPem: rootCert.toString("pem"),
    chainDer: [new Uint8Array(leafCert.rawData), new Uint8Array(rootCert.rawData)],
    devicePublicKeySpki,
  };
}

export { X509Certificate };
