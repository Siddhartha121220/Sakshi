/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_CHAIN_ID: string;
  readonly VITE_RPC_URL: string;
  readonly VITE_SAKSHI_ANCHOR_CONTRACT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
