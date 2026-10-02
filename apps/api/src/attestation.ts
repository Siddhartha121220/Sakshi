// Android Key Attestation verification: docs/PROTOCOL.md §2.3 (checks A1-A8).
//
// This is the one place the server decides whether a key really lives in a genuine phone's
// hardware (docs/THREAT_MODEL.md T2-T4). Checks are returned as a single pass/fail plus a reason
// code, rather than throwing, so callers can map it straight to the API's 422 ATTESTATION_FAILED
// response (docs/API.md).
import "reflect-metadata"; // required by @peculiar/x509's DI container (tsyringe) before it loads
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { X509Certificate } from "@peculiar/x509";
import { AsnConvert, OctetString } from "@peculiar/asn1-schema";
import { AttestationApplicationId, KeyMintKeyDescription, SecurityLevel, VerifiedBootState, id_ce_keyDescription } from "@peculiar/asn1-android";
import { asBufferSource } from "@sakshi/core";
import { verifyChallenge } from "./lib/challenge.js";

const rootsPath = join(dirname(fileURLToPath(import.meta.url)), "attestation-roots.json");
const GOOGLE_ROOT_PEMS: string[] = JSON.parse(readFileSync(rootsPath, "utf8"));

export type AttestationFailureReason =
  | "MALFORMED"
  | "BAD_CHALLENGE"
  | "UNTRUSTED_ROOT"
  | "REVOKED_CERT"
  | "SOFTWARE_KEY"
  | "UNLOCKED_BOOTLOADER"
  | "WRONG_APP"
  | "KEY_MISMATCH";

export type AttestationResult =
  | { ok: true; securityLevel: "tee" | "strongbox" }
  | { ok: false; reason: AttestationFailureReason };

export interface VerifyAttestationInput {
  /** The public key the device claims this chain attests to, SPKI DER (as submitted in POST /v1/devices). */
  publicKeySpki: Uint8Array;
  /** DER certs, leaf first, as submitted by the device. */
  attestationChainDer: Uint8Array[];
  /** The base64url challenge string the server previously issued (docs/PROTOCOL.md §2.1). */
  challenge: string;
  serverChallengeSecret: string;
  challengeTtlSeconds: number;
  allowedPackage: string;
  /** Lowercase hex sha256 digests of acceptable app signing certs. */
  allowedCertDigests: string[];
  /** Dev-only: skip real verification entirely, for the fake-device test script. Caller (config.ts)
   *  is responsible for refusing this in production — this function trusts the flag as given. */
  devSkipAttestation?: boolean;
  /** Injectable for tests; defaults to fetching Google's live revocation list. */
  fetchRevocationEntries?: () => Promise<Map<string, { status: string }>>;
  /** Injectable for tests; defaults to the real Google hardware attestation roots (attestation-roots.json). */
  trustedRootPems?: string[];
}

let revocationCache: { fetchedAt: number; entries: Map<string, { status: string }> } | null = null;
const REVOCATION_CACHE_TTL_MS = 60 * 60 * 1000;

async function fetchGoogleRevocationEntries(): Promise<Map<string, { status: string }>> {
  if (revocationCache && Date.now() - revocationCache.fetchedAt < REVOCATION_CACHE_TTL_MS) {
    return revocationCache.entries;
  }
  const res = await fetch("https://android.googleapis.com/attestation/status");
  if (!res.ok) {
    if (revocationCache) return revocationCache.entries; // serve stale rather than fail open
    throw new Error(`failed to fetch Google attestation revocation status: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { entries: Record<string, { status: string }> };
  const entries = new Map(Object.entries(json.entries));
  revocationCache = { fetchedAt: Date.now(), entries };
  return entries;
}

function normalizeSerialHex(serial: string): string {
  return BigInt(`0x${serial.replace(/^0x/i, "")}`).toString(16);
}

export async function verifyAndroidAttestation(input: VerifyAttestationInput): Promise<AttestationResult> {
  if (input.devSkipAttestation) {
    return { ok: true, securityLevel: "tee" };
  }

  // A4a: challenge itself must be a genuine, unexpired, server-issued one.
  const challengeCheck = verifyChallenge(input.serverChallengeSecret, input.challenge, input.challengeTtlSeconds);
  if (!challengeCheck.valid || !challengeCheck.bytes) {
    return { ok: false, reason: "BAD_CHALLENGE" };
  }

  if (input.attestationChainDer.length === 0) return { ok: false, reason: "MALFORMED" };

  let chain: X509Certificate[];
  try {
    chain = input.attestationChainDer.map((der) => new X509Certificate(asBufferSource(der)));
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  const leaf = chain[0]!;
  const now = new Date();

  // A1: chain verifies up to a current Google hardware attestation root.
  for (let i = 0; i < chain.length - 1; i++) {
    const signed = await chain[i]!.verify({ publicKey: chain[i + 1]!.publicKey, date: now });
    if (!signed) return { ok: false, reason: "UNTRUSTED_ROOT" };
  }
  const lastInChain = chain[chain.length - 1]!;
  let reachedRoot = false;
  for (const pem of input.trustedRootPems ?? GOOGLE_ROOT_PEMS) {
    const root = new X509Certificate(pem);
    if (await lastInChain.verify({ publicKey: root.publicKey, date: now })) {
      reachedRoot = true;
      break;
    }
  }
  if (!reachedRoot) return { ok: false, reason: "UNTRUSTED_ROOT" };

  // A2: no certificate in the chain is on Google's revocation list.
  try {
    const entries = await (input.fetchRevocationEntries ?? fetchGoogleRevocationEntries)();
    for (const cert of chain) {
      if (entries.has(normalizeSerialHex(cert.serialNumber))) {
        return { ok: false, reason: "REVOKED_CERT" };
      }
    }
  } catch {
    // Network failure: fail closed per docs/THREAT_MODEL.md T6 — we'd rather reject a legitimate
    // registration than accept a possibly-revoked device while we can't check.
    return { ok: false, reason: "REVOKED_CERT" };
  }

  // A3: leaf certificate's public key matches the key the device is registering.
  const leafSpki = new Uint8Array(leaf.publicKey.rawData);
  if (!bytesEqual(leafSpki, input.publicKeySpki)) {
    return { ok: false, reason: "KEY_MISMATCH" };
  }

  // Parse the KeyDescription extension (works for both legacy Keymaster and KeyMint layouts —
  // they're structurally identical; @peculiar/asn1-android's KeyMintKeyDescription reads either).
  const ext = leaf.getExtension(id_ce_keyDescription);
  if (!ext) return { ok: false, reason: "MALFORMED" };
  let keyDescription: KeyMintKeyDescription;
  try {
    keyDescription = AsnConvert.parse(ext.value, KeyMintKeyDescription);
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }

  // A4b: the challenge embedded in the cert is exactly the one we issued.
  const certChallenge = octetBytes(keyDescription.attestationChallenge);
  if (!bytesEqual(certChallenge, new Uint8Array(challengeCheck.bytes))) {
    return { ok: false, reason: "BAD_CHALLENGE" };
  }

  // A5: hardware-backed key only — reject software keys.
  const securityLevel = keyDescription.attestationSecurityLevel;
  if (securityLevel === SecurityLevel.software) {
    return { ok: false, reason: "SOFTWARE_KEY" };
  }

  // A6: device locked and boot verified.
  const rootOfTrust = keyDescription.hardwareEnforced.rootOfTrust;
  if (!rootOfTrust || !rootOfTrust.deviceLocked || rootOfTrust.verifiedBootState !== VerifiedBootState.verified) {
    return { ok: false, reason: "UNLOCKED_BOOTLOADER" };
  }

  // A7: this is our genuine app (package name + an allowed signing cert digest).
  const appIdBytes = keyDescription.hardwareEnforced.attestationApplicationId;
  if (!appIdBytes) return { ok: false, reason: "WRONG_APP" };
  const appIdCheck = checkAttestationApplicationId(
    octetBytes(appIdBytes),
    input.allowedPackage,
    input.allowedCertDigests,
  );
  if (!appIdCheck) return { ok: false, reason: "WRONG_APP" };

  return { ok: true, securityLevel: securityLevel === SecurityLevel.strongBox ? "strongbox" : "tee" };
}

function checkAttestationApplicationId(raw: Uint8Array, allowedPackage: string, allowedCertDigests: string[]): boolean {
  let appId: AttestationApplicationId;
  try {
    appId = AsnConvert.parse(raw, AttestationApplicationId);
  } catch {
    return false;
  }
  const hasAllowedPackage = appId.packageInfos.some(
    (p) => Buffer.from(octetBytes(p.packageName)).toString("utf8") === allowedPackage,
  );
  if (!hasAllowedPackage) return false;
  if (allowedCertDigests.length === 0) return true; // no digest allowlist configured (dev convenience)
  // Per the AttestationApplicationId schema, signatureDigests are already SHA-256 hashes of each
  // signing certificate (not raw cert bytes) — compared directly, not re-hashed.
  return appId.signatureDigests.some((d) => allowedCertDigests.includes(Buffer.from(octetBytes(d)).toString("hex")));
}

/**
 * @peculiar/asn1-schema deserialises an OCTET STRING-typed field as either an `OctetString`
 * instance (with a `.buffer`) or a plain `ArrayBuffer`, inconsistently depending on nesting depth
 * (confirmed empirically — e.g. AttestationPackageInfo.packageName comes back as a bare
 * ArrayBuffer while the enclosing structure's own octet fields come back wrapped). Handle both.
 */
function octetBytes(value: OctetString | ArrayBuffer): Uint8Array {
  return new Uint8Array(value instanceof ArrayBuffer ? value : value.buffer);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
