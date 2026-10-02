// Device-signed request authentication: docs/PROTOCOL.md §9. There are no accounts/passwords in
// v1 — a device proves it's itself by signing each mutation with its (already-attested) hardware key.
import { verifyP256Signature, fromBase64, sha256, toHex } from "@sakshi/core";

const MAX_CLOCK_SKEW_SECONDS = 300;

export interface DeviceAuthHeaders {
  deviceId: string;
  timestamp: number;
  signatureDer: Uint8Array;
}

/** Returns null if the required headers are missing or malformed (caller responds 401). */
export function parseDeviceAuthHeaders(headers: Record<string, string | string[] | undefined>): DeviceAuthHeaders | null {
  const deviceId = headers["x-sakshi-device"];
  const timestampRaw = headers["x-sakshi-timestamp"];
  const signatureB64 = headers["x-sakshi-signature"];
  if (typeof deviceId !== "string" || typeof timestampRaw !== "string" || typeof signatureB64 !== "string") {
    return null;
  }
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) return null;
  let signatureDer: Uint8Array;
  try {
    signatureDer = fromBase64(signatureB64);
  } catch {
    return null;
  }
  return { deviceId, timestamp, signatureDer };
}

export function isTimestampFresh(timestamp: number, nowSeconds: number = Date.now() / 1000): boolean {
  return Math.abs(nowSeconds - timestamp) <= MAX_CLOCK_SKEW_SECONDS;
}

/** Rebuilds the canonical request string (docs/PROTOCOL.md §9) and verifies it against the device's key. */
export async function verifyDeviceSignedRequest(opts: {
  method: string;
  path: string;
  timestamp: number;
  bodyBytes: Uint8Array;
  signatureDer: Uint8Array;
  devicePublicKeySpki: Uint8Array;
}): Promise<boolean> {
  const bodyHashHex = toHex(await sha256(opts.bodyBytes));
  const canonicalRequest = `${opts.method.toUpperCase()}\n${opts.path}\n${opts.timestamp}\n${bodyHashHex}`;
  return verifyP256Signature(opts.devicePublicKeySpki, new TextEncoder().encode(canonicalRequest), opts.signatureDer);
}
