import { useRef, useState } from "react";
import { parseProofBundle, type ProofBundle } from "@sakshi/core";
import { Dropzone } from "./components/Dropzone.js";
import { VerdictCard } from "./components/VerdictCard.js";
import { HowVerified } from "./components/HowVerified.js";
import { hashFileInWorker } from "./lib/hash-client.js";
import { createBrowserChainReader } from "./lib/chain-reader.js";
import { verifyUploadedFile, type AppVerdict } from "./lib/verify-flow.js";
import { reportVerificationEvent } from "./lib/api-client.js";
import type { HashResult } from "./lib/hash-types.js";

type Stage = "idle" | "hashing" | "verifying" | "done" | "error";

const chainReader = createBrowserChainReader();

export default function App() {
  const [stage, setStage] = useState<Stage>("idle");
  const [verdict, setVerdict] = useState<AppVerdict | null>(null);
  const [usedBundle, setUsedBundle] = useState<ProofBundle | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  // Name of a proof file that has been read and is waiting for its photo. Separate from `usedBundle`,
  // which is "the bundle behind the result on screen" — conflating the two hid the confirmation
  // whenever a previous result was still showing.
  const [pendingBundleName, setPendingBundleName] = useState<string | null>(null);
  const providedBundleRef = useRef<ProofBundle | null>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setPendingBundleName(null); // this photo consumes the loaded proof file (if any)
    setStage("hashing");
    setVerdict(null);
    setErrorMessage(null);
    setFileName(file.name);

    try {
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const hash: HashResult = await hashFileInWorker(file);

      setStage("verifying");
      const usedProvidedBundle = providedBundleRef.current !== null;
      const { verdict: result, bundle } = await verifyUploadedFile(fileBytes, hash, { chainReader }, providedBundleRef.current ?? undefined);
      setVerdict(result);
      setUsedBundle(bundle);

      const method = usedProvidedBundle ? "bundle_file" : result.verdict === "SIMILAR_TO_AUTHENTIC" ? "perceptual" : "exact";
      reportVerificationEvent({
        captureId: "capture" in result ? result.capture.captureId : null,
        method,
        verdict: result.verdict.toLowerCase(),
        hammingDistance: "distance" in result ? result.distance : undefined,
      });

      setStage("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStage("error");
    } finally {
      providedBundleRef.current = null;
    }
  }

  async function handleBundleFile(file: File) {
    try {
      const json = JSON.parse(await file.text());
      providedBundleRef.current = parseProofBundle(json);
      setPendingBundleName(file.name);
      // A new proof file starts a new check: clear the previous result so it can't be mistaken for this one.
      setVerdict(null);
      setUsedBundle(null);
      setErrorMessage(null);
      setStage("idle");
    } catch {
      providedBundleRef.current = null; // don't keep an earlier proof file around after a failed load
      setPendingBundleName(null);
      setErrorMessage("That doesn't look like a valid Sakshi proof bundle (.sakshi.json).");
      setStage("error");
    }
  }

  function clearBundle() {
    providedBundleRef.current = null;
    setPendingBundleName(null);
  }

  const busy = stage === "hashing" || stage === "verifying";

  return (
    <main className="page">
      <header>
        <h1>Sakshi</h1>
        <p className="tagline">Check whether a photo is unedited, genuinely camera-captured, and anchored on-chain — verified entirely in your browser.</p>
      </header>

      <Dropzone onFile={handleFile} disabled={busy} />

      <p className="bundle-upload-row">
        No internet, or the API is down?{" "}
        <button type="button" className="link-button" onClick={() => bundleInputRef.current?.click()} disabled={busy}>
          Upload a proof bundle file (.sakshi.json)
        </button>{" "}
        instead, then drop the photo above.
        <input
          ref={bundleInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleBundleFile(file);
            e.target.value = "";
          }}
        />
      </p>
      {pendingBundleName && (
        <div className="bundle-banner" role="status" aria-live="polite">
          <span className="bundle-banner-check" aria-hidden="true">✓</span>
          <div className="bundle-banner-text">
            <strong>JSON proof file uploaded</strong>
            <span className="bundle-banner-name">{pendingBundleName}</span>
            <span>Now upload the matching photo above.</span>
          </div>
          <button type="button" className="link-button" onClick={clearBundle}>
            Remove
          </button>
        </div>
      )}

      {stage === "hashing" && <p className="status-line" aria-live="polite">Hashing {fileName}…</p>}
      {stage === "verifying" && <p className="status-line" aria-live="polite">Checking the chain…</p>}
      {stage === "error" && errorMessage && (
        <p className="status-line status-error" role="alert">
          {errorMessage}
        </p>
      )}

      {stage === "done" && verdict && (
        <>
          <VerdictCard verdict={verdict} />
          <HowVerified verdict={verdict} bundle={usedBundle} />
        </>
      )}

      <footer>
        <a href="https://github.com/Siddhartha121220/Sakshi" target="_blank" rel="noreferrer">
          How Sakshi works ↗
        </a>
      </footer>
    </main>
  );
}
