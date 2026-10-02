import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toHex, fromHex } from "../src/bytes.js";
import {
  derToRawSignature,
  rawToDerSignature,
  generateP256KeyPair,
  exportSpki,
  signP256AsDer,
  verifyP256Signature,
} from "../src/signature.js";

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "test-vectors", "signature-encoding.json"), "utf8"),
) as Array<{ name: string; rawHex: string; derHex: string }>;

describe("DER <-> raw signature encoding (golden vectors)", () => {
  for (const v of vectors) {
    it(`rawToDerSignature matches the golden vector: ${v.name}`, () => {
      expect(toHex(rawToDerSignature(fromHex(v.rawHex)))).toBe(v.derHex);
    });
    it(`derToRawSignature matches the golden vector: ${v.name}`, () => {
      expect(toHex(derToRawSignature(fromHex(v.derHex)))).toBe(v.rawHex);
    });
  }
});

describe("DER <-> raw signature encoding (property checks)", () => {
  it("round-trips raw -> DER -> raw for arbitrary coordinates", () => {
    for (let trial = 0; trial < 50; trial++) {
      const raw = crypto.getRandomValues(new Uint8Array(64));
      const roundTripped = derToRawSignature(rawToDerSignature(raw));
      expect(toHex(roundTripped)).toBe(toHex(raw));
    }
  });

  it("rejects a DER blob with the wrong leading tag", () => {
    const bad = fromHex("310001"); // 0x31 (SET) instead of 0x30 (SEQUENCE)
    expect(() => derToRawSignature(bad)).toThrow(/SEQUENCE/);
  });

  it("rejects a raw signature of the wrong length", () => {
    expect(() => rawToDerSignature(new Uint8Array(63))).toThrow(/64 bytes/);
  });
});

describe("verifyP256Signature (end-to-end against WebCrypto)", () => {
  it("accepts a signature from the matching key, over the exact signed bytes", async () => {
    const { publicKey, privateKey } = await generateP256KeyPair();
    const spki = await exportSpki(publicKey);
    const data = new TextEncoder().encode("the manifest bytes");

    const der = await signP256AsDer(privateKey, data);

    expect(await verifyP256Signature(spki, data, der)).toBe(true);
  });

  it("rejects a signature over different bytes (tampered manifest)", async () => {
    const { publicKey, privateKey } = await generateP256KeyPair();
    const spki = await exportSpki(publicKey);
    const der = await signP256AsDer(privateKey, new TextEncoder().encode("original"));

    expect(await verifyP256Signature(spki, new TextEncoder().encode("tampered"), der)).toBe(false);
  });

  it("rejects a signature from a different key (impersonation attempt)", async () => {
    const real = await generateP256KeyPair();
    const attacker = await generateP256KeyPair();
    const data = new TextEncoder().encode("the manifest bytes");

    const derFromAttacker = await signP256AsDer(attacker.privateKey, data);
    const realSpki = await exportSpki(real.publicKey);

    expect(await verifyP256Signature(realSpki, data, derFromAttacker)).toBe(false);
  });
});
