import type { AppVerdict } from "../lib/verify-flow.js";

// docs/PRD.md §7. Icon + text together (never colour alone), per docs/PRD.md's accessibility NFR.
// Exported (not just used internally) so its mapping logic is unit-testable without a rendering
// library — see apps/web/test/verdict-card.test.ts.
export function describeVerdict(verdict: AppVerdict): { icon: string; tone: string; title: string; detail: string } {
  switch (verdict.verdict) {
    case "AUTHENTIC": {
      const { notBefore, notAfter } = verdict.provenTimeWindow;
      const window = notBefore
        ? `taken between ${notBefore.toLocaleString()} and ${notAfter.toLocaleString()}`
        : `taken no later than ${notAfter.toLocaleString()}`;
      return {
        icon: "✅",
        tone: "good",
        title: "Authentic",
        detail: `Unedited, signed by a genuine device (${verdict.securityLevel === "strongbox" ? "hardware security chip" : "trusted execution environment"}), and anchored on-chain. Proven ${window}.`,
      };
    }
    case "AUTHENTIC_PENDING":
      return {
        icon: "🟡",
        tone: "pending",
        title: "Authentic — anchoring pending",
        detail: "Signature verified, but this capture hasn't been anchored on-chain yet, so its upper time bound isn't proven. Check again in a few minutes.",
      };
    case "SIMILAR_TO_AUTHENTIC":
      return {
        icon: "🟦",
        tone: "info",
        title: "Similar to an authentic photo",
        detail: `This file's content closely matches a verified capture (Hamming distance ${verdict.distance}). It may just be recompressed (e.g. forwarded via WhatsApp) — or it may have been locally edited. Compare carefully.`,
      };
    case "DEVICE_REVOKED":
      return {
        icon: "⛔",
        tone: "bad",
        title: "Device revoked",
        detail: `Signed by a device key that was marked compromised on ${verdict.compromisedAt.toLocaleString()}, at or before this capture was anchored. Treat it as untrusted.`,
      };
    case "INVALID":
      return {
        icon: "❌",
        tone: "bad",
        title: "Invalid",
        detail: `A proof exists but failed verification: ${verdict.reason}.`,
      };
    case "NO_PROVENANCE":
      return {
        icon: "⚪",
        tone: "neutral",
        title: "No provenance",
        detail: "This file wasn't captured with Sakshi (or no match was found). That does not mean it's fake — just that it carries no cryptographic proof either way.",
      };
    case "LOOKUP_FAILED":
      return {
        icon: "⚠️",
        tone: "neutral",
        title: "Couldn't check",
        detail: `The verification service or chain RPC didn't respond (${verdict.message}). This is a connectivity problem, not a verdict about the photo.`,
      };
  }
}

export function VerdictCard({ verdict }: { verdict: AppVerdict }) {
  const { icon, tone, title, detail } = describeVerdict(verdict);
  return (
    <div className={`verdict-card verdict-${tone}`} role="status">
      <div className="verdict-icon" aria-hidden="true">
        {icon}
      </div>
      <div>
        <h2 className="verdict-title">{title}</h2>
        <p className="verdict-detail">{detail}</p>
      </div>
    </div>
  );
}
