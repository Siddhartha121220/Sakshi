import { describe, it, expect } from "vitest";
import { createChallenge, verifyChallenge } from "../src/lib/challenge.js";

const SECRET = "test-secret-at-least-16-bytes";

describe("challenge create/verify round trip", () => {
  it("accepts a freshly issued challenge", () => {
    const { challenge } = createChallenge(SECRET);
    const result = verifyChallenge(SECRET, challenge, 600);
    expect(result.valid).toBe(true);
    expect(result.bytes).toHaveLength(40); // ts(8) + rand(16) + mac(16), per docs/PROTOCOL.md §2.1
  });

  it("rejects a challenge signed with a different secret", () => {
    const { challenge } = createChallenge(SECRET);
    const result = verifyChallenge("a-completely-different-secret!!", challenge, 600);
    expect(result).toEqual({ valid: false, reason: "BAD_MAC" });
  });

  it("rejects a tampered challenge (flipped byte)", () => {
    const { challenge } = createChallenge(SECRET);
    const bytes = Buffer.from(challenge, "base64url");
    bytes[0] = bytes[0]! ^ 0xff;
    const result = verifyChallenge(SECRET, bytes.toString("base64url"), 600);
    expect(result).toEqual({ valid: false, reason: "BAD_MAC" });
  });

  it("rejects malformed input", () => {
    expect(verifyChallenge(SECRET, "not-base64url-of-the-right-length", 600)).toEqual({ valid: false, reason: "MALFORMED" });
    expect(verifyChallenge(SECRET, "", 600)).toEqual({ valid: false, reason: "MALFORMED" });
  });

  it("rejects an expired challenge", () => {
    const { challenge } = createChallenge(SECRET);
    const result = verifyChallenge(SECRET, challenge, -1); // TTL already elapsed
    expect(result).toEqual({ valid: false, reason: "EXPIRED" });
  });

  it("produces a distinct challenge on every call", () => {
    const a = createChallenge(SECRET);
    const b = createChallenge(SECRET);
    expect(a.challenge).not.toBe(b.challenge);
  });
});
