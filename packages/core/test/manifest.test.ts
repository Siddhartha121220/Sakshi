import { describe, it, expect } from "vitest";
import { buildManifestBytes, parseManifestBytes, type Manifest } from "../src/manifest.js";

function validManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    v: 1,
    type: "sakshi.capture",
    deviceId: "0192f1c2-1234-7890-abcd-ef0123456789",
    sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    mime: "image/jpeg",
    width: 4000,
    height: 3000,
    phash: "c3a1000000000000",
    tiles: Array.from({ length: 16 }, (_, i) => i.toString(16).padStart(16, "0")),
    capturedAt: "2026-10-02T10:42:13.512Z",
    app: { version: "0.1.0", build: 1 },
    ...overrides,
  };
}

describe("buildManifestBytes / parseManifestBytes round trip", () => {
  it("round-trips a minimal manifest", () => {
    const manifest = validManifest();
    const bytes = buildManifestBytes(manifest);
    const result = parseManifestBytes(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest).toEqual(manifest);
  });

  it("round-trips a manifest with beacon and location", () => {
    const manifest = validManifest({
      beacon: { chainId: 84532, blockNumber: 17234567, blockHash: `0x${"ab".repeat(32)}` },
      location: { lat: "12.972", lng: "77.595" },
    });
    const bytes = buildManifestBytes(manifest);
    const result = parseManifestBytes(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest).toEqual(manifest);
  });
});

describe("parseManifestBytes rejects bad input", () => {
  it("rejects non-canonical byte ordering", () => {
    const manifest = validManifest();
    // "type" before "v" before the rest — not the alphabetical order JCS requires.
    const wrongOrderKeys: (keyof Manifest)[] = ["type", "v", "deviceId", "sha256", "mime", "width", "height", "phash", "tiles", "capturedAt", "app"];
    const scrambled = JSON.stringify(Object.fromEntries(wrongOrderKeys.map((k) => [k, manifest[k]])));
    const result = parseManifestBytes(new TextEncoder().encode(scrambled));
    expect(result).toEqual({ ok: false, error: "NOT_CANONICAL" });
  });

  it("rejects a schema violation: bad deviceId (not a UUID)", () => {
    const bytes = buildManifestBytes(validManifest()); // construct valid first...
    const tampered = JSON.parse(new TextDecoder().decode(bytes));
    tampered.deviceId = "not-a-uuid";
    const rebuilt = new TextEncoder().encode(JSON.stringify(sortKeysDeep(tampered)));
    const result = parseManifestBytes(rebuilt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SCHEMA_INVALID");
  });

  it("rejects a schema violation: wrong number of tiles", () => {
    expect(() => buildManifestBytes(validManifest({ tiles: ["aaaa"] } as unknown as Partial<Manifest>))).toThrow();
  });

  it("rejects a schema violation: location with wrong decimal precision", () => {
    expect(() =>
      buildManifestBytes(validManifest({ location: { lat: "12.9", lng: "77.595" } })),
    ).toThrow();
  });

  it("rejects garbage bytes", () => {
    const result = parseManifestBytes(new TextEncoder().encode("not json at all"));
    expect(result.ok).toBe(false);
  });
});

// Minimal recursive key sort, used only to construct a valid-JCS-shaped-but-tampered fixture above
// (full JCS has more rules, but key order is the one this test needs).
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}
