// Build-time config (Vite only exposes VITE_*-prefixed env vars to the client — see .env.example).
// A verifier intentionally has no runtime "settings" beyond this: which API to ask for bundles,
// and which chain to read the truth from.

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var ${name} — see apps/web/.env.example`);
  return value;
}

export const config = {
  apiBaseUrl: required("VITE_API_BASE_URL", import.meta.env.VITE_API_BASE_URL),
  chainId: Number(required("VITE_CHAIN_ID", import.meta.env.VITE_CHAIN_ID)),
  rpcUrl: required("VITE_RPC_URL", import.meta.env.VITE_RPC_URL),
  contract: required("VITE_SAKSHI_ANCHOR_CONTRACT", import.meta.env.VITE_SAKSHI_ANCHOR_CONTRACT),
};
