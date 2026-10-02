// Unit tests for docs/PROTOCOL.md §2.3 (checks A1-A8), using a synthetic attestation chain
// (test/helpers/synthetic-attestation.ts) rather than a real device — see docs/ROADMAP.md Phase 0
// for the real-hardware spike this still needs before shipping.
import { describe, it, expect } from "vitest";
import * as android from "@peculiar/asn1-android";
import { createChallenge } from "../src/lib/challenge.js";
import { verifyAndroidAttestation, type VerifyAttestationInput } from "../src/attestation.js";
import { buildSyntheticAttestationChain } from "./helpers/synthetic-attestation.js";

const SECRET = "test-secret-at-least-16-bytes";
const emptyRevocationList = async () => new Map<string, { status: string }>();

function baseInput(overrides: Partial<VerifyAttestationInput> = {}): Omit<VerifyAttestationInput, "publicKeySpki" | "attestationChainDer" | "challenge" | "trustedRootPems"> {
  return {
    serverChallengeSecret: SECRET,
    challengeTtlSeconds: 600,
    allowedPackage: "app.sakshi",
    allowedCertDigests: ["aa".repeat(32)],
    fetchRevocationEntries: emptyRevocationList,
    ...overrides,
  };
}

describe("verifyAndroidAttestation", () => {
  it("accepts a well-formed chain and reports the correct security level", async () => {
    const { challenge } = createChallenge(SECRET);
    const challengeBytes = Buffer.from(challenge, "base64url");
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes, securityLevel: android.SecurityLevel.strongBox });

    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [synthetic.rootPem],
    });

    expect(result).toEqual({ ok: true, securityLevel: "strongbox" });
  });

  it("bypasses everything when devSkipAttestation is set", async () => {
    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: new Uint8Array(0),
      attestationChainDer: [],
      challenge: "garbage",
      devSkipAttestation: true,
    });
    expect(result).toEqual({ ok: true, securityLevel: "tee" });
  });

  it("rejects an expired/unknown challenge", async () => {
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes: Buffer.from("not-a-real-challenge") });
    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge: "not-a-real-server-issued-challenge",
      trustedRootPems: [synthetic.rootPem],
    });
    expect(result).toEqual({ ok: false, reason: "BAD_CHALLENGE" });
  });

  it("rejects when the cert's embedded challenge doesn't match the one issued", async () => {
    const { challenge } = createChallenge(SECRET); // issued, valid...
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes: Buffer.from("a-different-challenge-entirely") }); // ...but cert has a different one
    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [synthetic.rootPem],
    });
    expect(result).toEqual({ ok: false, reason: "BAD_CHALLENGE" });
  });

  it("rejects a chain that doesn't lead to a trusted root", async () => {
    const { challenge } = createChallenge(SECRET);
    const challengeBytes = Buffer.from(challenge, "base64url");
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes });
    const otherRoot = await buildSyntheticAttestationChain({ challengeBytes }); // a different, unrelated root

    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [otherRoot.rootPem], // not synthetic's actual root
    });
    expect(result).toEqual({ ok: false, reason: "UNTRUSTED_ROOT" });
  });

  it("rejects a software-level key", async () => {
    const { challenge } = createChallenge(SECRET);
    const challengeBytes = Buffer.from(challenge, "base64url");
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes, securityLevel: android.SecurityLevel.software });

    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [synthetic.rootPem],
    });
    expect(result).toEqual({ ok: false, reason: "SOFTWARE_KEY" });
  });

  it("rejects an unlocked bootloader", async () => {
    const { challenge } = createChallenge(SECRET);
    const challengeBytes = Buffer.from(challenge, "base64url");
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes, deviceLocked: false });

    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [synthetic.rootPem],
    });
    expect(result).toEqual({ ok: false, reason: "UNLOCKED_BOOTLOADER" });
  });

  it("rejects an unverified boot state", async () => {
    const { challenge } = createChallenge(SECRET);
    const challengeBytes = Buffer.from(challenge, "base64url");
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes, verifiedBootState: android.VerifiedBootState.unverified });

    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [synthetic.rootPem],
    });
    expect(result).toEqual({ ok: false, reason: "UNLOCKED_BOOTLOADER" });
  });

  it("rejects a mismatched package name (a repackaged/modified app)", async () => {
    const { challenge } = createChallenge(SECRET);
    const challengeBytes = Buffer.from(challenge, "base64url");
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes, packageName: "com.evil.repackaged" });

    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [synthetic.rootPem],
    });
    expect(result).toEqual({ ok: false, reason: "WRONG_APP" });
  });

  it("rejects a signing certificate not on the allowlist", async () => {
    const { challenge } = createChallenge(SECRET);
    const challengeBytes = Buffer.from(challenge, "base64url");
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes, signatureDigestsHex: ["bb".repeat(32)] });

    const result = await verifyAndroidAttestation({
      ...baseInput({ allowedCertDigests: ["aa".repeat(32)] }),
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [synthetic.rootPem],
    });
    expect(result).toEqual({ ok: false, reason: "WRONG_APP" });
  });

  it("rejects when the submitted public key doesn't match the leaf certificate's key", async () => {
    const { challenge } = createChallenge(SECRET);
    const challengeBytes = Buffer.from(challenge, "base64url");
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes });
    const unrelated = await buildSyntheticAttestationChain({ challengeBytes });

    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: unrelated.devicePublicKeySpki, // doesn't match synthetic's leaf cert
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [synthetic.rootPem],
    });
    expect(result).toEqual({ ok: false, reason: "KEY_MISMATCH" });
  });

  it("rejects a certificate whose serial number is on Google's revocation list", async () => {
    const { challenge } = createChallenge(SECRET);
    const challengeBytes = Buffer.from(challenge, "base64url");
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes });

    const result = await verifyAndroidAttestation({
      ...baseInput({ fetchRevocationEntries: async () => new Map([["2", { status: "REVOKED" }]]) }), // leaf's serial is "02"
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [synthetic.rootPem],
    });
    expect(result).toEqual({ ok: false, reason: "REVOKED_CERT" });
  });

  it("fails closed when the revocation list can't be fetched", async () => {
    const { challenge } = createChallenge(SECRET);
    const challengeBytes = Buffer.from(challenge, "base64url");
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes });

    const result = await verifyAndroidAttestation({
      ...baseInput({
        fetchRevocationEntries: async () => {
          throw new Error("network down");
        },
      }),
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [synthetic.rootPem],
    });
    expect(result).toEqual({ ok: false, reason: "REVOKED_CERT" });
  });

  it("rejects a chain with no certificates", async () => {
    const { challenge } = createChallenge(SECRET);
    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: new Uint8Array(32),
      attestationChainDer: [],
      challenge,
    });
    expect(result).toEqual({ ok: false, reason: "MALFORMED" });
  });

  it("rejects malformed certificate bytes", async () => {
    const { challenge } = createChallenge(SECRET);
    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: new Uint8Array(32),
      attestationChainDer: [new Uint8Array([1, 2, 3])],
      challenge,
    });
    expect(result).toEqual({ ok: false, reason: "MALFORMED" });
  });

  it("rejects a leaf with no KeyDescription extension at all", async () => {
    const { challenge } = createChallenge(SECRET);
    const challengeBytes = Buffer.from(challenge, "base64url");
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes, omitKeyDescriptionExtension: true });

    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [synthetic.rootPem],
    });
    expect(result).toEqual({ ok: false, reason: "MALFORMED" });
  });

  it("rejects a leaf with no attestationApplicationId (can't prove which app this is)", async () => {
    const { challenge } = createChallenge(SECRET);
    const challengeBytes = Buffer.from(challenge, "base64url");
    const synthetic = await buildSyntheticAttestationChain({ challengeBytes, omitAttestationApplicationId: true });

    const result = await verifyAndroidAttestation({
      ...baseInput(),
      publicKeySpki: synthetic.devicePublicKeySpki,
      attestationChainDer: synthetic.chainDer,
      challenge,
      trustedRootPems: [synthetic.rootPem],
    });
    expect(result).toEqual({ ok: false, reason: "WRONG_APP" });
  });
});
