// Manual demo / load-test script — docs/ROADMAP.md Phase 3 exit criteria: register a fake device
// and submit a batch of captures against a running API (with DEV_SKIP_ATTESTATION=true).
//
//   BASE_URL=http://localhost:3000 COUNT=1000 pnpm fake-device
import { registerFakeDevice, submitFakeCapture } from "../test/helpers/fake-device.js";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const count = Number(process.env.COUNT ?? 20);

const device = await registerFakeDevice(baseUrl);
console.log(`registered device ${device.deviceId}`);

const started = Date.now();
for (let i = 0; i < count; i++) {
  const { captureId, status } = await submitFakeCapture(baseUrl, device, { withBeacon: i % 10 === 0 });
  if (i % 100 === 0 || i === count - 1) console.log(`[${i + 1}/${count}] ${captureId} -> ${status}`);
}
console.log(`submitted ${count} captures in ${((Date.now() - started) / 1000).toFixed(1)}s`);
