const EXPLORERS: Record<number, string> = {
  8453: "https://basescan.org",
  84532: "https://sepolia.basescan.org",
};

export function txExplorerUrl(chainId: number, txHash: string): string | null {
  const base = EXPLORERS[chainId];
  return base ? `${base}/tx/${txHash}` : null; // no public explorer for a local chain (e.g. Anvil)
}
