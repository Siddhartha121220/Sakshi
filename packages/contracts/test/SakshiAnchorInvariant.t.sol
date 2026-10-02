// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SakshiAnchor} from "../src/SakshiAnchor.sol";
import {SakshiAnchorHandler} from "./handlers/SakshiAnchorHandler.sol";

/// @notice Invariants from docs/ARCHITECTURE.md §2.4: batches are append-only and never modified,
///         and revocation timestamps only ever move earlier, never later or back to zero.
contract SakshiAnchorInvariantTest is Test {
    SakshiAnchor anchor;
    SakshiAnchorHandler handler;

    address admin = makeAddr("admin");
    address anchorer = makeAddr("anchorer");
    address revoker = makeAddr("revoker");

    function setUp() public {
        anchor = new SakshiAnchor(admin);
        vm.startPrank(admin);
        anchor.grantRole(anchor.ANCHORER_ROLE(), anchorer);
        anchor.grantRole(anchor.REVOKER_ROLE(), revoker);
        vm.stopPrank();

        handler = new SakshiAnchorHandler(anchor, anchorer, revoker);
        targetContract(address(handler));
    }

    /// @dev Every batch the handler recorded must still be present, unchanged, at the same index.
    function invariant_batchesMatchGhostModel() public view {
        assertEq(anchor.batchCount(), handler.ghostBatchCount());

        uint256 n = handler.ghostBatchCount();
        for (uint256 i = 0; i < n; i++) {
            (bytes32 root,, uint32 leafCount) = anchor.batches(i);
            assertEq(root, handler.ghostRoots(i), "root mutated or reordered");
            assertEq(leafCount, handler.ghostLeafCounts(i), "leafCount mutated");
        }
    }

    /// @dev batchCount never decreases call-to-call — append-only, no deletions. Foundry calls
    ///      invariants repeatedly through a run, so this also guards against any shrink-on-revert bug.
    function invariant_batchCountNeverShrinksBelowGhost() public view {
        assertGe(anchor.batchCount(), handler.ghostBatchCount());
    }

    /// @dev The on-chain compromisedAt for every key the handler touched matches the ghost model,
    ///      which only accepts moves to an earlier timestamp (see SakshiAnchorHandler.revokeDevice).
    function invariant_revocationMatchesGhostModel() public view {
        uint256 n = handler.seenKeyHashCount();
        for (uint256 i = 0; i < n; i++) {
            bytes32 keyHash = handler.seenKeyHashAt(i);
            assertEq(anchor.deviceCompromisedAt(keyHash), handler.ghostCompromisedAt(keyHash));
        }
    }
}
