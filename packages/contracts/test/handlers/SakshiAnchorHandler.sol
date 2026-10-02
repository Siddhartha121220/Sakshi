// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SakshiAnchor} from "../../src/SakshiAnchor.sol";

/// @notice Drives SakshiAnchor through random-ish call sequences for invariant testing, while
///         tracking a shadow model the invariant tests check the real contract against.
contract SakshiAnchorHandler is Test {
    SakshiAnchor public immutable anchor;
    address public immutable anchorer;
    address public immutable revoker;

    // Shadow model: batches anchored so far, in order (ghost state mirroring the contract).
    bytes32[] public ghostRoots;
    uint32[] public ghostLeafCounts;

    // Shadow model: last-seen compromisedAt per key, to assert monotonicity.
    mapping(bytes32 => uint64) public ghostCompromisedAt;
    bytes32[] public seenKeyHashes;

    constructor(SakshiAnchor _anchor, address _anchorer, address _revoker) {
        anchor = _anchor;
        anchorer = _anchorer;
        revoker = _revoker;
    }

    function anchorBatch(bytes32 root, uint32 leafCount) external {
        root = root == bytes32(0) ? bytes32(uint256(1)) : root;
        leafCount = leafCount == 0 ? 1 : leafCount;

        vm.prank(anchorer);
        anchor.anchor(root, leafCount);

        ghostRoots.push(root);
        ghostLeafCounts.push(leafCount);
    }

    function revokeDevice(bytes32 keyHash, uint64 compromisedAt, uint8 reason) external {
        keyHash = keyHash == bytes32(0) ? bytes32(uint256(1)) : keyHash;
        compromisedAt = compromisedAt == 0 ? 1 : compromisedAt;

        uint64 current = ghostCompromisedAt[keyHash];
        if (current != 0) {
            // Only attempt moves that the contract should accept; the unit/fuzz tests already
            // cover the revert path explicitly, so the handler avoids wasting invariant runs on it.
            if (compromisedAt >= current) return;
        } else {
            seenKeyHashes.push(keyHash);
        }

        vm.prank(revoker);
        anchor.revokeDevice(keyHash, compromisedAt, reason);
        ghostCompromisedAt[keyHash] = compromisedAt;
    }

    function ghostBatchCount() external view returns (uint256) {
        return ghostRoots.length;
    }

    function seenKeyHashCount() external view returns (uint256) {
        return seenKeyHashes.length;
    }

    function seenKeyHashAt(uint256 i) external view returns (bytes32) {
        return seenKeyHashes[i];
    }
}
