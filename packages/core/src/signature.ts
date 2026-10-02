// ECDSA P-256 signatures and SPKI public keys.
//
// Android Keystore (and most CAs/HSMs) emit signatures as ASN.1 DER: SEQUENCE { INTEGER r, INTEGER s }.
// WebCrypto's ECDSA verify/sign only speaks the raw IEEE P1363 format: 32-byte r followed by 32-byte s.
// docs/PROTOCOL.md §1 calls this out explicitly — this module is the one place that conversion happens.
import { asBufferSource, concatBytes } from "./bytes.js";

const P256_COORD_LEN = 32;

/** Reads a DER length field starting at `offset`. Returns [length, nextOffset]. */
function readDerLength(der: Uint8Array, offset: number): [length: number, next: number] {
  const first = der[offset];
  if (first === undefined) throw new Error("malformed DER: truncated length");
  if ((first & 0x80) === 0) return [first, offset + 1];
  const numBytes = first & 0x7f;
  if (numBytes === 0 || numBytes > 4) throw new Error("malformed DER: unsupported length encoding");
  let length = 0;
  for (let i = 0; i < numBytes; i++) {
    const byte = der[offset + 1 + i];
    if (byte === undefined) throw new Error("malformed DER: truncated length");
    length = (length << 8) | byte;
  }
  return [length, offset + 1 + numBytes];
}

function readDerInteger(der: Uint8Array, offset: number): [value: Uint8Array, next: number] {
  if (der[offset] !== 0x02) throw new Error("malformed DER: expected INTEGER tag");
  const [length, contentStart] = readDerLength(der, offset + 1);
  const value = der.slice(contentStart, contentStart + length);
  if (value.length !== length) throw new Error("malformed DER: truncated INTEGER");
  return [value, contentStart + length];
}

/** Left-pads/strips a DER INTEGER's big-endian bytes to exactly 32 bytes (P-256 coordinate width). */
function derIntegerToFixedWidth(bytes: Uint8Array): Uint8Array {
  // DER prepends a 0x00 to otherwise-negative (high-bit-set) positive integers; strip it.
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0x00) start++;
  const trimmed = bytes.slice(start);
  if (trimmed.length > P256_COORD_LEN) throw new Error("malformed DER: integer too large for P-256");
  const out = new Uint8Array(P256_COORD_LEN);
  out.set(trimmed, P256_COORD_LEN - trimmed.length);
  return out;
}

/** Encodes a 32-byte big-endian coordinate as a minimal DER INTEGER. */
function fixedWidthToDerInteger(coord: Uint8Array): Uint8Array {
  let start = 0;
  while (start < coord.length - 1 && coord[start] === 0x00) start++;
  let trimmed: Uint8Array = coord.slice(start);
  // If the high bit is set, the DER INTEGER would read as negative — prepend a 0x00 pad byte.
  if ((trimmed[0]! & 0x80) !== 0) {
    trimmed = concatBytes(new Uint8Array([0x00]), trimmed);
  }
  return concatBytes(new Uint8Array([0x02, trimmed.length]), trimmed);
}

/** Converts a DER-encoded ECDSA signature (Android Keystore's format) to raw r‖s (64 bytes, WebCrypto's format). */
export function derToRawSignature(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("malformed DER: expected SEQUENCE tag");
  const [, contentStart] = readDerLength(der, 1);
  const [rBytes, afterR] = readDerInteger(der, contentStart);
  const [sBytes] = readDerInteger(der, afterR);
  return concatBytes(derIntegerToFixedWidth(rBytes), derIntegerToFixedWidth(sBytes));
}

/** Converts a raw r‖s ECDSA signature (64 bytes, WebCrypto's format) to DER (Android Keystore's format). */
export function rawToDerSignature(raw: Uint8Array): Uint8Array {
  if (raw.length !== 2 * P256_COORD_LEN) throw new Error(`raw signature must be ${2 * P256_COORD_LEN} bytes`);
  const r = fixedWidthToDerInteger(raw.slice(0, P256_COORD_LEN));
  const s = fixedWidthToDerInteger(raw.slice(P256_COORD_LEN));
  const content = concatBytes(r, s);
  return concatBytes(new Uint8Array([0x30, content.length]), content);
}

/** Imports a P-256 public key from SPKI DER bytes (the format Android Keystore / X.509 certs use). */
export function importP256PublicKey(spki: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", asBufferSource(spki), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

/**
 * Verifies a DER-encoded ECDSA P-256 signature over `data`.
 * This is docs/PROTOCOL.md §8 step 5.
 */
export async function verifyP256Signature(
  publicKeySpki: Uint8Array,
  data: Uint8Array,
  signatureDer: Uint8Array,
): Promise<boolean> {
  const key = await importP256PublicKey(publicKeySpki);
  const raw = derToRawSignature(signatureDer);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, asBufferSource(raw), asBufferSource(data));
}

/** Generates a P-256 keypair for tests/fixtures (simulating a device's hardware key). */
export async function generateP256KeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]) as Promise<CryptoKeyPair>;
}

export async function exportSpki(publicKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("spki", publicKey));
}

/** Signs `data` and returns a DER-encoded signature, matching what Android Keystore would produce. */
export async function signP256AsDer(privateKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, asBufferSource(data)));
  return rawToDerSignature(raw);
}
