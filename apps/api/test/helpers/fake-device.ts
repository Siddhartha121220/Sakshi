// A software "device" that talks to the real HTTP API exactly as the Android app will, without
// real hardware: generates its own P-256 key and relies on the server's DEV_SKIP_ATTESTATION
// escape hatch (CONTRIBUTING.md: must never be available in production) instead of a real Key
// Attestation chain. Used by integration tests and by `scripts/fake-device.ts`'s manual demo.
import {
  buildManifestBytes,
  exportSpki,
  generateP256KeyPair,
  sha256,
  signP256AsDer,
  toBase64,
  toHex,
  type Manifest,
} from "@sakshi/core";

export interface FakeDevice {
  deviceId: string;
  publicKeySpki: Uint8Array;
  privateKey: CryptoKey;
}

export async function registerFakeDevice(baseUrl: string): Promise<FakeDevice> {
  const { publicKey, privateKey } = await generateP256KeyPair();
  const publicKeySpki = await exportSpki(publicKey);

  const challengeRes = await fetch(`${baseUrl}/v1/devices/challenge`, { method: "POST" });
  if (!challengeRes.ok) throw new Error(`challenge request failed: ${challengeRes.status}`);
  const { challenge } = (await challengeRes.json()) as { challenge: string };

  const registerRes = await fetch(`${baseUrl}/v1/devices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challenge, publicKey: toBase64(publicKeySpki), attestationChain: [], appVersion: "0.1.0-fake" }),
  });
  if (!registerRes.ok) throw new Error(`device registration failed: ${registerRes.status} ${await registerRes.text()}`);
  const { deviceId } = (await registerRes.json()) as { deviceId: string };

  return { deviceId, publicKeySpki, privateKey };
}

export interface SubmitCaptureOptions {
  withBeacon?: boolean;
  /** Real photo bytes to commit to (e.g. a JPEG for a browser test); random bytes otherwise. */
  photoBytes?: Uint8Array;
}

export interface SubmittedCapture {
  captureId: string;
  status: string;
  /** The "photo" bytes this capture's manifest.sha256 commits to — returned so callers (tests)
   *  can exercise full verification without the server ever having seen or stored the photo. */
  photoBytes: Uint8Array;
}

export async function submitFakeCapture(
  baseUrl: string,
  device: FakeDevice,
  opts: SubmitCaptureOptions = {},
): Promise<SubmittedCapture> {
  const fakePhotoBytes = opts.photoBytes ?? crypto.getRandomValues(new Uint8Array(32)); // stands in for a real JPEG
  const sha256Hex = toHex(await sha256(fakePhotoBytes));

  let beacon: Manifest["beacon"];
  if (opts.withBeacon) {
    const beaconRes = await fetch(`${baseUrl}/v1/time-beacon`);
    const b = (await beaconRes.json()) as { chainId: number; blockNumber: number; blockHash: string };
    beacon = { chainId: b.chainId, blockNumber: b.blockNumber, blockHash: b.blockHash as `0x${string}` };
  }

  const manifest: Manifest = {
    v: 1,
    type: "sakshi.capture",
    deviceId: device.deviceId,
    sha256: sha256Hex,
    mime: "image/jpeg",
    width: 100,
    height: 100,
    phash: "0000000000000000",
    tiles: Array.from({ length: 16 }, () => "0000000000000000"),
    capturedAt: new Date().toISOString(),
    app: { version: "0.1.0-fake", build: 1 },
    ...(beacon ? { beacon } : {}),
  };
  const manifestBytes = buildManifestBytes(manifest);
  const signatureDer = await signP256AsDer(device.privateKey, manifestBytes);

  const bodyBytes = new TextEncoder().encode(JSON.stringify({ manifest: toBase64(manifestBytes), signature: toBase64(signatureDer) }));
  const timestamp = Math.floor(Date.now() / 1000);
  const path = "/v1/captures";
  const canonicalRequest = `POST\n${path}\n${timestamp}\n${toHex(await sha256(bodyBytes))}`;
  const requestSignature = await signP256AsDer(device.privateKey, new TextEncoder().encode(canonicalRequest));

  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sakshi-device": device.deviceId,
      "x-sakshi-timestamp": String(timestamp),
      "x-sakshi-signature": toBase64(requestSignature),
    },
    body: bodyBytes,
  });
  if (!res.ok) throw new Error(`capture submission failed: ${res.status} ${await res.text()}`);
  const { captureId, status } = (await res.json()) as { captureId: string; status: string };
  return { captureId, status, photoBytes: fakePhotoBytes };
}
