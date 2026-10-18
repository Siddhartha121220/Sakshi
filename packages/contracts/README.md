# @sakshi/contracts

`SakshiAnchor.sol` — anchors Merkle roots of signed photo-capture fingerprints and tracks revoked
device keys. See [docs/ARCHITECTURE.md §2.4](../../docs/ARCHITECTURE.md) for the design and
[docs/PROTOCOL.md §4](../../docs/PROTOCOL.md) for the off-chain leaf encoding this contract expects.

## Setup
`lib/` is gitignored (not vendored). After cloning:
```bash
forge install foundry-rs/forge-std --no-git --no-commit
forge install OpenZeppelin/openzeppelin-contracts@v5.7.0 --no-git --no-commit
```

## Commands
```bash
forge build
forge test              # unit + fuzz (1000 runs) + invariant (256 runs x 64 depth)
forge coverage --report summary
forge fmt
```

## Static analysis
```bash
python3 -m venv .venv-slither && .venv-slither/bin/pip install slither-analyzer
.venv-slither/bin/slither . --filter-paths "lib|test|script" --exclude-dependencies
```
Current result: **1 informational finding, 0 high/medium** — a known Slither false positive. Its
`timestamp` detector flags `verify()`'s `batchId >= batches.length` bounds check, even though that
function never reads `block.timestamp`. Confirmed as a non-issue; re-check after any Slither upgrade.

## Coverage
100% lines/statements/branches/functions on `src/SakshiAnchor.sol`. (`script/Deploy.s.sol` is
exercised by the testnet deployment step instead of unit tests.)

## Deploying
```bash
cp .env.example .env   # fill in DEPLOYER_PRIVATE_KEY, ANCHORER_ADDRESS, REVOKER_ADDRESS, RPC URL

# local (anvil)
anvil &
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# Base Sepolia
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
```
On testnet the deployer address keeps `DEFAULT_ADMIN_ROLE`. Before any production deployment,
transfer admin to a multisig — see `docs/THREAT_MODEL.md` T15. This is a deliberate manual step,
not automated by the script.

## Live deployments
| Network | Chain ID | SakshiAnchor | Deployed |
|---|---|---|---|
| Base Sepolia (testnet) | 84532 | `0xf412dE9954A9d8caa35a0B6c1c6E193703765B51` | 2026-10-18, tx `0x5a4b5aea87fad3ac89b6b444c78dbb3007552a4fa2c2634d65dbfcd5d220a4a6` |

Testnet roles: one generated testnet wallet (`0x17021A2E6b47676300143E59ca54112230f0067d`) holds admin, anchorer
and revoker; its key lives only in the gitignored `.env.sepolia`. Production must split these roles and
put admin behind a multisig (docs/THREAT_MODEL.md T14/T15). Deploy cost was ~0.0000056 ETH; an anchor is
~0.0000005 ETH at 0.006 gwei. Source not yet verified on Basescan (needs a `BASESCAN_API_KEY`).
Transaction record: `broadcast/Deploy.s.sol/84532/`.
