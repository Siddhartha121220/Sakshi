// Device registration challenge: docs/PROTOCOL.md §2.1. Stateless — the server never stores
// outstanding challenges, since the HMAC + timestamp alone makes a challenge self-verifying.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const MAC_LEN = 16;

export function createChallenge(secret: string): { challenge: string; expiresAt: Date } {
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
  const rand = randomBytes(16);
  const mac = hmac(secret, Buffer.concat([ts, rand])).subarray(0, MAC_LEN);
  const challenge = Buffer.concat([ts, rand, mac]).toString("base64url");
  return { challenge, expiresAt: new Date(Date.now() + 1000 * 60 * 10) };
}

export interface ChallengeCheck {
  valid: boolean;
  reason?: "MALFORMED" | "BAD_MAC" | "EXPIRED";
  /** The full raw 40 bytes of the challenge (docs/PROTOCOL.md §2.2: this is what Android's
   *  setAttestationChallenge() is given, and so what ends up in attestationChallenge — not just ts‖rand). */
  bytes?: Buffer;
}

export function verifyChallenge(secret: string, challenge: string, ttlSeconds: number): ChallengeCheck {
  let raw: Buffer;
  try {
    raw = Buffer.from(challenge, "base64url");
  } catch {
    return { valid: false, reason: "MALFORMED" };
  }
  if (raw.length !== 8 + 16 + MAC_LEN) return { valid: false, reason: "MALFORMED" };

  const ts = raw.subarray(0, 8);
  const rand = raw.subarray(8, 24);
  const mac = raw.subarray(24, 24 + MAC_LEN);
  const expectedMac = hmac(secret, Buffer.concat([ts, rand])).subarray(0, MAC_LEN);
  if (mac.length !== expectedMac.length || !timingSafeEqual(mac, expectedMac)) {
    return { valid: false, reason: "BAD_MAC" };
  }

  const issuedAt = Number(ts.readBigUInt64BE());
  if (Date.now() / 1000 - issuedAt > ttlSeconds) return { valid: false, reason: "EXPIRED" };

  return { valid: true, bytes: raw };
}

function hmac(secret: string, data: Buffer): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}
