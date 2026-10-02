import { describe, it, expect } from "vitest";
import { txExplorerUrl } from "../src/lib/explorer.js";

describe("txExplorerUrl", () => {
  it("links to Basescan for Base mainnet", () => {
    expect(txExplorerUrl(8453, "0xabc")).toBe("https://basescan.org/tx/0xabc");
  });

  it("links to Sepolia Basescan for Base Sepolia", () => {
    expect(txExplorerUrl(84532, "0xabc")).toBe("https://sepolia.basescan.org/tx/0xabc");
  });

  it("returns null for a chain with no known public explorer (e.g. local Anvil)", () => {
    expect(txExplorerUrl(31337, "0xabc")).toBeNull();
  });
});
