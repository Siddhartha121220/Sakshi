import { describe, it, expect } from "vitest";
import { describeVerdict } from "../src/components/VerdictCard.js";
import type { AppVerdict } from "../src/lib/verify-flow.js";
import type { Manifest } from "@sakshi/core";
import type { CaptureSummary } from "../src/lib/api-client.js";

const manifest = {
  v: 1,
  type: "sakshi.capture",
  deviceId: "0192f1c2-1234-7890-abcd-ef0123456789",
  sha256: "a".repeat(64),
  mime: "image/jpeg",
  width: 100,
  height: 100,
  phash: "0".repeat(16),
  tiles: Array.from({ length: 16 }, () => "0".repeat(16)),
  capturedAt: "2026-10-02T10:00:00.000Z",
  app: { version: "1.0.0", build: 1 },
} as unknown as Manifest;

describe("describeVerdict", () => {
  it("every verdict kind maps to a distinct, non-empty icon/title/detail", () => {
    const cases: AppVerdict[] = [
      { verdict: "AUTHENTIC", manifest, securityLevel: "strongbox", provenTimeWindow: { notAfter: new Date() } },
      { verdict: "AUTHENTIC", manifest, securityLevel: "tee", provenTimeWindow: { notBefore: new Date(0), notAfter: new Date() } },
      { verdict: "AUTHENTIC_PENDING", manifest, securityLevel: "tee" },
      { verdict: "SIMILAR_TO_AUTHENTIC", distance: 4, manifest, capture: {} as CaptureSummary },
      { verdict: "DEVICE_REVOKED", manifest, compromisedAt: new Date(), provenTimeWindow: { notAfter: new Date() } },
      { verdict: "INVALID", reason: "signature does not verify" },
      { verdict: "NO_PROVENANCE" },
      { verdict: "LOOKUP_FAILED", message: "network error" },
    ];

    const seenTitles = new Set<string>();
    for (const v of cases) {
      const { icon, title, detail, tone } = describeVerdict(v);
      expect(icon.length).toBeGreaterThan(0);
      expect(title.length).toBeGreaterThan(0);
      expect(detail.length).toBeGreaterThan(0);
      expect(tone.length).toBeGreaterThan(0);
      seenTitles.add(title);
    }
    expect(seenTitles.size).toBe(cases.length - 1); // the two AUTHENTIC cases share a title; all others distinct
  });

  it("mentions the specific failure reason for INVALID", () => {
    const { detail } = describeVerdict({ verdict: "INVALID", reason: "beacon block hash mismatch" });
    expect(detail).toContain("beacon block hash mismatch");
  });

  it("mentions the Hamming distance for SIMILAR_TO_AUTHENTIC", () => {
    const { detail } = describeVerdict({ verdict: "SIMILAR_TO_AUTHENTIC", distance: 7, manifest, capture: {} as CaptureSummary });
    expect(detail).toContain("7");
  });

  it("distinguishes hardware security chip (strongbox) from TEE wording", () => {
    const strongbox = describeVerdict({ verdict: "AUTHENTIC", manifest, securityLevel: "strongbox", provenTimeWindow: { notAfter: new Date() } });
    const tee = describeVerdict({ verdict: "AUTHENTIC", manifest, securityLevel: "tee", provenTimeWindow: { notAfter: new Date() } });
    expect(strongbox.detail).toContain("hardware security chip");
    expect(tee.detail).toContain("trusted execution environment");
  });
});
