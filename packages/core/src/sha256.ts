// SHA-256 via WebCrypto, which is available as a global in both Node 20+ and every evergreen
// browser — no extra dependency needed (CONTRIBUTING.md: keep dependencies minimal).
import { asBufferSource, toHex } from "./bytes.js";

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", asBufferSource(data));
  return new Uint8Array(digest);
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(await sha256(data));
}
