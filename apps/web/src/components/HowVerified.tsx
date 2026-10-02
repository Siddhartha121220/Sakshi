import type { ProofBundle } from "@sakshi/core";
import type { AppVerdict } from "../lib/verify-flow.js";
import { txExplorerUrl } from "../lib/explorer.js";

interface Check {
  label: string;
  done: boolean;
}

function checksFor(verdict: AppVerdict): Check[] {
  const hasBundle = !("verdict" in verdict) ? false : verdict.verdict !== "NO_PROVENANCE" && verdict.verdict !== "LOOKUP_FAILED";
  const anchored = verdict.verdict === "AUTHENTIC" || verdict.verdict === "DEVICE_REVOKED";
  return [
    { label: "File hashed in your browser (the file was never uploaded anywhere)", done: true },
    { label: "A signed proof was found for this file", done: hasBundle },
    { label: "Signature verified against the device's hardware key", done: hasBundle },
    { label: "Merkle proof checked against the on-chain root", done: anchored || verdict.verdict === "SIMILAR_TO_AUTHENTIC" },
    { label: "On-chain root read directly from the chain (not from the API)", done: anchored },
    { label: "Device revocation status checked on-chain", done: anchored },
  ];
}

export function HowVerified({ verdict, bundle }: { verdict: AppVerdict; bundle?: ProofBundle | null }) {
  const checks = checksFor(verdict);
  const explorerUrl = bundle?.anchor ? txExplorerUrl(bundle.anchor.chainId, bundle.anchor.txHash) : null;

  return (
    <details className="how-verified">
      <summary>How this was verified</summary>
      <ul>
        {checks.map((c) => (
          <li key={c.label} className={c.done ? "check-done" : "check-skipped"}>
            <span aria-hidden="true">{c.done ? "✓" : "–"}</span> {c.label}
          </li>
        ))}
      </ul>
      {explorerUrl && (
        <p>
          <a href={explorerUrl} target="_blank" rel="noreferrer">
            View the anchor transaction on the block explorer ↗
          </a>
        </p>
      )}
      <p className="how-verified-note">
        Every check above runs against the blockchain directly from your browser — the Sakshi
        server is only ever asked to <em>hand over</em> a proof, never trusted to produce a verdict.
      </p>
    </details>
  );
}
