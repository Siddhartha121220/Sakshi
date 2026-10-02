// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SakshiAnchor} from "../src/SakshiAnchor.sol";
import {MerkleTreeHelper} from "./helpers/MerkleTreeHelper.sol";

contract SakshiAnchorTest is Test {
    SakshiAnchor anchor;

    address admin = makeAddr("admin");
    address anchorer = makeAddr("anchorer");
    address revoker = makeAddr("revoker");
    address stranger = makeAddr("stranger");

    function setUp() public {
        anchor = new SakshiAnchor(admin);
        vm.startPrank(admin);
        anchor.grantRole(anchor.ANCHORER_ROLE(), anchorer);
        anchor.grantRole(anchor.REVOKER_ROLE(), revoker);
        vm.stopPrank();
    }

    // ---------- anchor() ----------

    function test_anchor_storesRootAndEmits() public {
        bytes32 root = keccak256("root-1");

        vm.expectEmit(true, true, false, true);
        emit SakshiAnchor.RootAnchored(0, root, 42, uint64(block.timestamp));

        vm.prank(anchorer);
        uint256 batchId = anchor.anchor(root, 42);

        assertEq(batchId, 0);
        assertEq(anchor.batchCount(), 1);
        (bytes32 storedRoot, uint64 ts, uint32 leafCount) = anchor.batches(0);
        assertEq(storedRoot, root);
        assertEq(ts, uint64(block.timestamp));
        assertEq(leafCount, 42);
    }

    function test_anchor_batchIdsIncrement() public {
        vm.startPrank(anchorer);
        uint256 id0 = anchor.anchor(keccak256("a"), 1);
        uint256 id1 = anchor.anchor(keccak256("b"), 1);
        uint256 id2 = anchor.anchor(keccak256("c"), 1);
        vm.stopPrank();

        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(anchor.batchCount(), 3);
    }

    function test_anchor_revertsForNonAnchorer() public {
        // Resolved before pranking: a view call here would otherwise consume the one-shot prank.
        bytes32 role = anchor.ANCHORER_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("AccessControlUnauthorizedAccount(address,bytes32)")), stranger, role
            )
        );
        anchor.anchor(keccak256("root"), 1);
    }

    function test_anchor_revertsOnZeroRoot() public {
        vm.prank(anchorer);
        vm.expectRevert(SakshiAnchor.ZeroRoot.selector);
        anchor.anchor(bytes32(0), 1);
    }

    function test_anchor_revertsOnZeroLeafCount() public {
        vm.prank(anchorer);
        vm.expectRevert(SakshiAnchor.ZeroLeafCount.selector);
        anchor.anchor(keccak256("root"), 0);
    }

    function testFuzz_anchor_alwaysStoresExactly(bytes32 root, uint32 leafCount) public {
        vm.assume(root != bytes32(0) && leafCount != 0);

        vm.prank(anchorer);
        uint256 batchId = anchor.anchor(root, leafCount);

        (bytes32 storedRoot,, uint32 storedCount) = anchor.batches(batchId);
        assertEq(storedRoot, root);
        assertEq(storedCount, leafCount);
    }

    // ---------- verify() ----------

    function test_verify_trueForValidProof_falseForWrongLeaf() public {
        bytes32[] memory leaves = new bytes32[](4);
        leaves[0] = keccak256("leaf-0");
        leaves[1] = keccak256("leaf-1");
        leaves[2] = keccak256("leaf-2");
        leaves[3] = keccak256("leaf-3");

        (bytes32 root, bytes32[] memory proof) = MerkleTreeHelper.rootAndProof(leaves, 2);

        vm.prank(anchorer);
        uint256 batchId = anchor.anchor(root, 4);

        assertTrue(anchor.verify(batchId, proof, leaves[2]));
        assertFalse(anchor.verify(batchId, proof, leaves[1])); // right proof, wrong leaf
    }

    function test_verify_revertsForUnknownBatch() public {
        bytes32[] memory emptyProof = new bytes32[](0);
        vm.expectRevert(abi.encodeWithSelector(SakshiAnchor.BatchDoesNotExist.selector, 0));
        anchor.verify(0, emptyProof, keccak256("leaf"));
    }

    function testFuzz_verify_matchesHelperForAnySubsetSize(uint8 rawCount, uint8 rawTarget) public {
        uint256 count = (uint256(rawCount) % 20) + 1; // 1..20 leaves
        uint256 target = uint256(rawTarget) % count;

        bytes32[] memory leaves = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            leaves[i] = keccak256(abi.encode("leaf", i));
        }

        (bytes32 root, bytes32[] memory proof) = MerkleTreeHelper.rootAndProof(leaves, target);

        vm.prank(anchorer);
        uint256 batchId = anchor.anchor(root, uint32(count));

        assertTrue(anchor.verify(batchId, proof, leaves[target]));
    }

    // ---------- revokeDevice() ----------

    function test_revokeDevice_setsCompromisedAtAndReason() public {
        bytes32 keyHash = keccak256("device-key");

        vm.expectEmit(true, false, false, true);
        emit SakshiAnchor.DeviceRevoked(keyHash, 1000, 7);

        vm.prank(revoker);
        anchor.revokeDevice(keyHash, 1000, 7);

        assertEq(anchor.deviceCompromisedAt(keyHash), 1000);
        assertEq(anchor.deviceRevokeReason(keyHash), 7);
    }

    function test_revokeDevice_canMoveEarlier() public {
        bytes32 keyHash = keccak256("device-key");

        vm.startPrank(revoker);
        anchor.revokeDevice(keyHash, 1000, 1);
        anchor.revokeDevice(keyHash, 500, 2); // earlier — allowed
        vm.stopPrank();

        assertEq(anchor.deviceCompromisedAt(keyHash), 500);
        assertEq(anchor.deviceRevokeReason(keyHash), 2);
    }

    function test_revokeDevice_revertsMovingLater() public {
        bytes32 keyHash = keccak256("device-key");

        vm.startPrank(revoker);
        anchor.revokeDevice(keyHash, 1000, 1);
        vm.expectRevert(abi.encodeWithSelector(SakshiAnchor.RevocationNotEarlier.selector, 1000, 1500));
        anchor.revokeDevice(keyHash, 1500, 1);
        vm.stopPrank();
    }

    function test_revokeDevice_revertsSettingSameTimestamp() public {
        bytes32 keyHash = keccak256("device-key");

        vm.startPrank(revoker);
        anchor.revokeDevice(keyHash, 1000, 1);
        vm.expectRevert(abi.encodeWithSelector(SakshiAnchor.RevocationNotEarlier.selector, 1000, 1000));
        anchor.revokeDevice(keyHash, 1000, 1);
        vm.stopPrank();
    }

    function test_revokeDevice_revertsForNonRevoker() public {
        bytes32 role = anchor.REVOKER_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("AccessControlUnauthorizedAccount(address,bytes32)")), stranger, role
            )
        );
        anchor.revokeDevice(keccak256("k"), 1, 0);
    }

    function test_revokeDevice_revertsOnZeroKeyHash() public {
        vm.prank(revoker);
        vm.expectRevert(SakshiAnchor.ZeroDeviceKeyHash.selector);
        anchor.revokeDevice(bytes32(0), 1, 0);
    }

    function test_revokeDevice_revertsOnZeroCompromisedAt() public {
        vm.prank(revoker);
        vm.expectRevert(SakshiAnchor.ZeroCompromisedAt.selector);
        anchor.revokeDevice(keccak256("k"), 0, 0);
    }

    function testFuzz_revokeDevice_neverMovesLaterThanCurrent(
        bytes32 keyHash,
        uint64 first,
        uint64 second,
        uint8 reason
    ) public {
        vm.assume(keyHash != bytes32(0) && first != 0 && second != 0);

        vm.startPrank(revoker);
        anchor.revokeDevice(keyHash, first, reason);

        if (second >= first) {
            vm.expectRevert(abi.encodeWithSelector(SakshiAnchor.RevocationNotEarlier.selector, first, second));
            anchor.revokeDevice(keyHash, second, reason);
            assertEq(anchor.deviceCompromisedAt(keyHash), first); // unchanged
        } else {
            anchor.revokeDevice(keyHash, second, reason);
            assertEq(anchor.deviceCompromisedAt(keyHash), second); // moved earlier
        }
        vm.stopPrank();
    }
}
