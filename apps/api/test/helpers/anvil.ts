// Spawns a local Anvil (Foundry's dev chain) for integration tests, and deploys SakshiAnchor to
// it from the Foundry build artifact — no forge-script/CLI dependency at test time, just viem.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { createPublicClient, createWalletClient, http, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { makeChain } from "../../src/chain.js";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export interface AnvilAccount {
  address: `0x${string}`;
  privateKey: `0x${string}`;
}

export interface AnvilInstance {
  rpcUrl: string;
  chainId: number;
  accounts: AnvilAccount[];
  stop(): Promise<void>;
}

export async function startAnvil(): Promise<AnvilInstance> {
  const port = await getFreePort();
  const chainId = 31337;
  const proc: ChildProcessWithoutNullStreams = spawn("anvil", ["--port", String(port), "--chain-id", String(chainId)]);

  let output = "";
  await new Promise<void>((resolve, reject) => {
    const onData = (buf: Buffer) => {
      output += buf.toString();
      if (output.includes("Listening on")) resolve();
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`anvil exited early with code ${code}:\n${output}`));
    });
    setTimeout(() => reject(new Error(`anvil did not start within 10s:\n${output}`)), 10_000);
  });

  // Anvil prints "(N) 0x<64 hex>" for private keys and "(N) 0x<40 hex>" for addresses — the length
  // distinguishes them, so this regex only picks up the private-key section.
  const privateKeys = [...output.matchAll(/\(\d+\)\s+(0x[0-9a-fA-F]{64})/g)].map((m) => m[1] as `0x${string}`);
  const accounts = privateKeys.map((privateKey) => ({ privateKey, address: privateKeyToAccount(privateKey).address }));

  return {
    rpcUrl: `http://127.0.0.1:${port}`,
    chainId,
    accounts,
    async stop() {
      proc.kill();
    },
  };
}

export interface DeployedContract {
  address: `0x${string}`;
  abi: Abi;
  anchorer: AnvilAccount;
  revoker: AnvilAccount;
}

export async function deploySakshiAnchor(anvil: AnvilInstance): Promise<DeployedContract> {
  const artifactPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "packages",
    "contracts",
    "out",
    "SakshiAnchor.sol",
    "SakshiAnchor.json",
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { abi: Abi; bytecode: { object: `0x${string}` } };

  const chain = makeChain(anvil.chainId);
  const admin = anvil.accounts[0]!;
  const anchorer = anvil.accounts[1]!;
  const revoker = anvil.accounts[2]!;

  const adminAccount = privateKeyToAccount(admin.privateKey);
  const walletClient = createWalletClient({ account: adminAccount, chain, transport: http(anvil.rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(anvil.rpcUrl) });

  const deployHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [adminAccount.address],
  });
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const address = deployReceipt.contractAddress!;

  const anchorerRole = await publicClient.readContract({ address, abi: artifact.abi, functionName: "ANCHORER_ROLE" });
  const revokerRole = await publicClient.readContract({ address, abi: artifact.abi, functionName: "REVOKER_ROLE" });

  const grant = async (role: unknown, account: `0x${string}`) => {
    const hash = await walletClient.writeContract({ address, abi: artifact.abi, functionName: "grantRole", args: [role, account] });
    await publicClient.waitForTransactionReceipt({ hash });
  };
  await grant(anchorerRole, anchorer.address);
  await grant(revokerRole, revoker.address);

  return { address, abi: artifact.abi, anchorer, revoker };
}
