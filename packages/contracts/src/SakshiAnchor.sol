// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title SakshiAnchor
/// @notice Anchors Merkle roots of signed photo-capture fingerprints, and tracks revoked device keys.
/// @dev Non-upgradeable and append-only by design: history must never be editable, not even by an admin.
///      See docs/ARCHITECTURE.md §2.4 and §7 (D9), and docs/PROTOCOL.md §4 for the leaf encoding this
///      contract's `verify` expects callers to reproduce off-chain.
contract SakshiAnchor is AccessControl {
    /// @notice May call `anchor`. Held by the backend's anchor worker (a hot wallet with minimal funds).
    bytes32 public constant ANCHORER_ROLE = keccak256("ANCHORER_ROLE");

    /// @notice May call `revokeDevice`. Held by an operator or governance multisig.
    bytes32 public constant REVOKER_ROLE = keccak256("REVOKER_ROLE");

    struct Batch {
        bytes32 root;
        uint64 timestamp; // block.timestamp at anchoring — the proven "existed no later than" bound
        uint32 leafCount;
    }

    /// @notice All anchored batches, in order. `batchId` is the index into this array.
    Batch[] public batches;

    /// @notice sha256(device SPKI DER) => unix time the device's key was compromised, or 0 if never revoked.
    mapping(bytes32 deviceKeyHash => uint64 compromisedAt) public deviceCompromisedAt;

    /// @notice Why a device was revoked. Informational only; verifiers may ignore it.
    mapping(bytes32 deviceKeyHash => uint8 reason) public deviceRevokeReason;

    event RootAnchored(uint256 indexed batchId, bytes32 indexed root, uint32 leafCount, uint64 timestamp);
    event DeviceRevoked(bytes32 indexed deviceKeyHash, uint64 compromisedAt, uint8 reason);

    error ZeroRoot();
    error ZeroLeafCount();
    error BatchDoesNotExist(uint256 batchId);
    error ZeroDeviceKeyHash();
    error ZeroCompromisedAt();
    error RevocationNotEarlier(uint64 current, uint64 attempted);

    /// @param admin Holds DEFAULT_ADMIN_ROLE. In production this must be a multisig (see docs/THREAT_MODEL.md T15).
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Records a new Merkle root covering `leafCount` capture fingerprints.
    /// @dev Batches are append-only: there is deliberately no function to edit or remove one.
    function anchor(bytes32 root, uint32 leafCount) external onlyRole(ANCHORER_ROLE) returns (uint256 batchId) {
        if (root == bytes32(0)) revert ZeroRoot();
        if (leafCount == 0) revert ZeroLeafCount();

        batchId = batches.length;
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 ts = uint64(block.timestamp); // safe: uint64 doesn't overflow until the year 2554
        batches.push(Batch({root: root, timestamp: ts, leafCount: leafCount}));

        emit RootAnchored(batchId, root, leafCount, ts);
    }

    /// @notice Marks a device key as compromised as of `compromisedAt`.
    /// @dev A key already revoked can only have its `compromisedAt` moved *earlier*, never later and
    ///      never cleared — see docs/ARCHITECTURE.md §2.4 invariants. This keeps revocation monotonic:
    ///      a verifier's "is this capture after the compromise?" check can only ever become stricter.
    function revokeDevice(bytes32 deviceKeyHash, uint64 compromisedAt, uint8 reason) external onlyRole(REVOKER_ROLE) {
        if (deviceKeyHash == bytes32(0)) revert ZeroDeviceKeyHash();
        if (compromisedAt == 0) revert ZeroCompromisedAt();

        uint64 current = deviceCompromisedAt[deviceKeyHash];
        if (current != 0 && compromisedAt >= current) {
            revert RevocationNotEarlier(current, compromisedAt);
        }

        deviceCompromisedAt[deviceKeyHash] = compromisedAt;
        deviceRevokeReason[deviceKeyHash] = reason;

        emit DeviceRevoked(deviceKeyHash, compromisedAt, reason);
    }

    /// @notice Checks that `leaf` is included in the Merkle tree anchored as `batchId`.
    /// @dev Pure read — callers still must independently check `deviceCompromisedAt` themselves
    ///      (see docs/PROTOCOL.md §8, step 11) since a leaf can be validly included yet later-revoked.
    function verify(uint256 batchId, bytes32[] calldata proof, bytes32 leaf) external view returns (bool) {
        if (batchId >= batches.length) revert BatchDoesNotExist(batchId);
        return MerkleProof.verify(proof, batches[batchId].root, leaf);
    }

    /// @notice Number of batches anchored so far.
    function batchCount() external view returns (uint256) {
        return batches.length;
    }
}
