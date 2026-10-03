// Verifies src/attestation.ts against a REAL Android Key Attestation chain from a physical phone
// (docs/ROADMAP.md Phase 0's spike), as opposed to test/attestation.test.ts's synthetic chains.
//
// Why this file earns its keep: the synthetic generator necessarily encodes *our* reading of the
// Android schema, so it happily agreed with a bug that made every genuine device fail. The real
// chain put attestationApplicationId in the software-enforced list — where real Keystore always
// puts it, because the TEE has no concept of an Android package name — while the code (and the
// synthetic fixture) looked only in the hardware-enforced list. Result: WRONG_APP for 100% of real
// phones, invisible behind DEV_SKIP_ATTESTATION. Only real hardware could have shown that.
import "reflect-metadata"; // must precede @peculiar/x509 (its tsyringe DI container needs it at load)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { X509Certificate } from "@peculiar/x509";
import { verifyAndroidAttestation } from "../src/attestation.js";

interface Fixture {
  device: { model: string; vendor: string };
  securityLevel: "tee" | "strongbox";
  challenge: string;
  challengeSecret: string;
  allowedPackage: string;
  allowedCertDigests: string[];
  publicKeySpki: string;
  attestationChain: string[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "real-attestation-oneplus-cph2381.json"), "utf8"),
);

const chainDer = fixture.attestationChain.map((b64) => new Uint8Array(Buffer.from(b64, "base64")));
const publicKeySpki = new Uint8Array(Buffer.from(fixture.publicKeySpki, "base64"));

// The fixture was captured in a past run, so its challenge is long past the 10-minute production
// TTL. Challenge freshness/expiry is its own concern and is covered by test/challenge.test.ts;
// here we widen the window so the chain itself is what's under test.
const IGNORE_CHALLENGE_AGE = 10 ** 9;

function baseInput() {
  return {
    publicKeySpki,
    attestationChainDer: chainDer,
    challenge: fixture.challenge,
    serverChallengeSecret: fixture.challengeSecret,
    challengeTtlSeconds: IGNORE_CHALLENGE_AGE,
    allowedPackage: fixture.allowedPackage,
    allowedCertDigests: fixture.allowedCertDigests,
    // Keep the suite offline and deterministic; revocation handling is covered against synthetic
    // chains in test/attestation.test.ts.
    fetchRevocationEntries: async () => new Map<string, { status: string }>(),
  };
}

describe(`real device attestation (${fixture.device.vendor} ${fixture.device.model})`, () => {
  it("accepts a genuine chain, all the way up to Google's hardware attestation root", async () => {
    // Note this uses the real GOOGLE_ROOT_PEMS (no trustedRootPems override), so it also pins that
    // the shipped root list actually contains the root real hardware chains to.
    const result = await verifyAndroidAttestation(baseInput());

    expect(result).toEqual({ ok: true, securityLevel: fixture.securityLevel });
  });

  it("rejects the real chain when the attesting app isn't ours", async () => {
    const result = await verifyAndroidAttestation({ ...baseInput(), allowedPackage: "com.example.evil" });

    expect(result).toEqual({ ok: false, reason: "WRONG_APP" });
  });

  it("rejects the real chain when the app signing digest isn't allowed", async () => {
    const result = await verifyAndroidAttestation({ ...baseInput(), allowedCertDigests: ["00".repeat(32)] });

    expect(result).toEqual({ ok: false, reason: "WRONG_APP" });
  });

  it("rejects the real chain against a challenge it wasn't minted for", async () => {
    const result = await verifyAndroidAttestation({ ...baseInput(), serverChallengeSecret: "a-different-server-secret" });

    expect(result).toEqual({ ok: false, reason: "BAD_CHALLENGE" });
  });

  it("rejects the real chain if a cert in it is on the revocation list", async () => {
    const serial = new X509Certificate(chainDer[1]!.buffer as ArrayBuffer).serialNumber;
    const normalized = BigInt(`0x${serial}`).toString(16);

    const result = await verifyAndroidAttestation({
      ...baseInput(),
      fetchRevocationEntries: async () => new Map([[normalized, { status: "REVOKED" }]]),
    });

    expect(result).toEqual({ ok: false, reason: "REVOKED_CERT" });
  });
});
