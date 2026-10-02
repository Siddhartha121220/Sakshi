import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jcsEncode, isCanonicalJcs } from "../src/jcs.js";
import { toHex, fromHex } from "../src/bytes.js";

const vectors = JSON.parse(readFileSync(join(import.meta.dirname, "..", "test-vectors", "jcs.json"), "utf8")) as Array<{
  name: string;
  input: unknown;
  canonicalUtf8Hex: string;
}>;

describe("jcsEncode", () => {
  it("sorts object keys lexicographically", () => {
    const bytes = jcsEncode({ b: 1, a: 2 });
    expect(new TextDecoder().decode(bytes)).toBe('{"a":2,"b":1}');
  });

  it("produces no whitespace", () => {
    const bytes = jcsEncode({ a: [1, 2], b: { c: 3 } });
    expect(new TextDecoder().decode(bytes)).toBe('{"a":[1,2],"b":{"c":3}}');
  });

  for (const v of vectors) {
    it(`matches the golden vector: ${v.name}`, () => {
      expect(toHex(jcsEncode(v.input))).toBe(v.canonicalUtf8Hex);
    });
  }
});

describe("isCanonicalJcs", () => {
  it("accepts bytes produced by jcsEncode", () => {
    const bytes = jcsEncode({ z: 1, a: 2 });
    expect(isCanonicalJcs(bytes)).toBe(true);
  });

  it("rejects non-canonical key order", () => {
    const nonCanonical = new TextEncoder().encode('{"z":1,"a":2}');
    expect(isCanonicalJcs(nonCanonical)).toBe(false);
  });

  it("rejects whitespace", () => {
    const withSpace = new TextEncoder().encode('{"a": 1}');
    expect(isCanonicalJcs(withSpace)).toBe(false);
  });

  it("rejects invalid JSON", () => {
    expect(isCanonicalJcs(new TextEncoder().encode("not json"))).toBe(false);
  });

  it("rejects bytes that don't round-trip (e.g. a single tampered byte)", () => {
    const bytes = jcsEncode({ a: "hello" });
    const tampered = fromHex(toHex(bytes)); // sanity: round trip via hex is identity
    tampered[tampered.length - 2] = "x".charCodeAt(0); // corrupt a content byte, keep it valid JSON-ish
    // Not guaranteed to still be valid JSON, but either way isCanonicalJcs must not accept it as-is.
    expect(isCanonicalJcs(tampered)).toBe(false);
  });
});
