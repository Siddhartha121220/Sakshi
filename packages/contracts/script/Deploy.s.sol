// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {SakshiAnchor} from "../src/SakshiAnchor.sol";

/// @notice Deploys SakshiAnchor and grants the operational roles.
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY  - deploys the contract and is granted DEFAULT_ADMIN_ROLE
///   ANCHORER_ADDRESS      - granted ANCHORER_ROLE (the backend anchor worker's hot wallet)
///   REVOKER_ADDRESS       - granted REVOKER_ROLE
/// On testnet the deployer keeps admin. In production, admin must be transferred to a multisig
/// (docs/THREAT_MODEL.md T15) — not automated here on purpose, so it's a deliberate, reviewed step.
contract DeployScript is Script {
    function run() external returns (SakshiAnchor anchor) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address anchorerAddr = vm.envAddress("ANCHORER_ADDRESS");
        address revokerAddr = vm.envAddress("REVOKER_ADDRESS");

        vm.startBroadcast(deployerKey);

        anchor = new SakshiAnchor(deployer);
        anchor.grantRole(anchor.ANCHORER_ROLE(), anchorerAddr);
        anchor.grantRole(anchor.REVOKER_ROLE(), revokerAddr);

        vm.stopBroadcast();

        console.log("SakshiAnchor deployed at:", address(anchor));
        console.log("Admin (deployer):", deployer);
        console.log("Anchorer:", anchorerAddr);
        console.log("Revoker:", revokerAddr);
    }
}
