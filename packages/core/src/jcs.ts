// JSON Canonicalization Scheme (RFC 8785). Uses the `canonicalize` package rather than a
// hand-rolled implementation: RFC 8785's float-formatting rules (ECMA-262 Number::toString) have
// sharp edges, and getting them wrong would silently break Kotlin<->TypeScript signature
// compatibility (docs/PROTOCOL.md §3.2 requires both sides to produce byte-identical output).
import canonicalize from "canonicalize";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Canonicalises `value` per RFC 8785 and returns the UTF-8 encoded bytes. */
export function jcsEncode(value: unknown): Uint8Array {
  const json = canonicalize(value);
  if (json === undefined) {
    throw new Error("jcsEncode: value is not JSON-serialisable (undefined/function/symbol at top level)");
  }
  return encoder.encode(json);
}

/**
 * True iff `bytes` is exactly the canonical JCS encoding of its own parsed content.
 * This is the check docs/PROTOCOL.md §8 step 3 requires every verifier to run: it rejects
 * duplicate-key tricks and any manifest that wasn't canonicalised by the signer.
 */
export function isCanonicalJcs(bytes: Uint8Array): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return false;
  }
  const recanonical = jcsEncode(parsed);
  return recanonical.length === bytes.length && recanonical.every((b, i) => b === bytes[i]);
}
