// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Builds a Merkle tree using OpenZeppelin's sorted-pair keccak256 hashing: the same
///         algorithm the OpenZeppelin merkle-tree JS package uses, and the same one MerkleProof.sol
///         verifies against. Test-only: a naive O(n^2) rebuild-per-proof implementation, fine for
///         the small trees used in unit/fuzz tests.
library MerkleTreeHelper {
    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @dev `leaves` must be non-empty. Returns the root and, for `target`, its proof.
    function rootAndProof(bytes32[] memory leaves, uint256 target)
        internal
        pure
        returns (bytes32 root, bytes32[] memory proof)
    {
        require(leaves.length > 0, "no leaves");
        require(target < leaves.length, "bad target");

        uint256 proofLen = 0;
        {
            uint256 n = leaves.length;
            while (n > 1) {
                proofLen++;
                n = (n + 1) / 2;
            }
        }
        proof = new bytes32[](proofLen);
        uint256 proofCount = 0;

        bytes32[] memory level = leaves;
        uint256 idx = target;

        while (level.length > 1) {
            uint256 n = level.length;
            uint256 nextLen = (n + 1) / 2;
            bytes32[] memory next = new bytes32[](nextLen);

            for (uint256 i = 0; i < nextLen; i++) {
                uint256 li = i * 2;
                uint256 ri = li + 1;
                bytes32 l = level[li];

                if (ri < n) {
                    bytes32 r = level[ri];
                    next[i] = hashPair(l, r);
                    if (li == idx) {
                        proof[proofCount++] = r;
                        idx = i;
                    } else if (ri == idx) {
                        proof[proofCount++] = l;
                        idx = i;
                    }
                } else {
                    // odd one out carries up unpaired, no sibling to add to the proof
                    next[i] = l;
                    if (li == idx) idx = i;
                }
            }
            level = next;
        }

        root = level[0];
        // Trim proof to actual length (odd-node levels can produce fewer siblings than proofLen).
        assembly {
            mstore(proof, proofCount)
        }
    }
}
