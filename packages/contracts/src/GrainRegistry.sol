// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IGrainRegistry} from "./interfaces/IGrainRegistry.sol";
import {IFingerprintIndex} from "./interfaces/IFingerprintIndex.sol";

/// @title GrainRegistry
/// @notice Onchain C2PA manifest repository.
/// @dev    Manifests live in EVENT DATA, not contract storage. Storage holds
///         only the hash. Event data is permanent chain history readable by any
///         node or indexer; contract storage would only add contract-readable
///         access that nothing in this system needs, at many times the cost.
///         That difference is what makes per-asset registration economical.
contract GrainRegistry is IGrainRegistry {
    uint256 public constant MAX_MANIFEST_BYTES = 16 * 1024;

    IFingerprintIndex public immutable index;

    mapping(uint64 => Record) private _records;
    uint64 public nextRecordId = 1; // 0 is the null id

    constructor(IFingerprintIndex index_) {
        index = index_;
    }

    function register(uint64 expectedRecordId, uint64 fingerprint, bytes calldata manifest)
        external
        returns (uint64 recordId)
    {
        return _write(expectedRecordId, fingerprint, manifest);
    }

    function supersede(uint64 oldId, uint64 expectedRecordId, uint64 fingerprint, bytes calldata manifest)
        external
        returns (uint64 newId)
    {
        Record storage old = _records[oldId];
        if (old.creator == address(0)) revert UnknownRecord(oldId);
        if (old.creator != msg.sender) revert NotCreator(oldId, msg.sender);
        if (old.revoked) revert AlreadyRevoked(oldId);

        newId = _write(expectedRecordId, fingerprint, manifest);
        old.supersededBy = newId;
        emit ManifestSuperseded(oldId, newId);
    }

    function revoke(uint64 recordId) external {
        Record storage r = _records[recordId];
        if (r.creator == address(0)) revert UnknownRecord(recordId);
        if (r.creator != msg.sender) revert NotCreator(recordId, msg.sender);
        if (r.revoked) revert AlreadyRevoked(recordId);
        r.revoked = true;
        emit ManifestRevoked(recordId);
    }

    function records(uint64 recordId) external view returns (Record memory) {
        return _records[recordId];
    }

    function _write(uint64 expectedRecordId, uint64 fingerprint, bytes calldata manifest)
        internal
        returns (uint64 recordId)
    {
        if (manifest.length > MAX_MANIFEST_BYTES) {
            revert ManifestTooLarge(manifest.length, MAX_MANIFEST_BYTES);
        }

        recordId = nextRecordId;
        // The caller embedded a watermark carrying this id before computing the
        // fingerprint it is registering. If another registration landed first,
        // that watermark now points at someone else's record -- fail loudly
        // rather than bind it to the wrong one.
        if (expectedRecordId != recordId) revert UnexpectedRecordId(expectedRecordId, recordId);
        nextRecordId = recordId + 1;

        _records[recordId] = Record({
            creator: msg.sender,
            fingerprint: fingerprint,
            manifestHash: keccak256(manifest),
            // forge-lint: disable-next-line(unsafe-typecast)
            // uint40 seconds overflows in the year 36812; packing the Record
            // into fewer slots is worth more than that headroom.
            registeredAt: uint40(block.timestamp),
            supersededBy: 0,
            revoked: false
        });

        index.insert(recordId, fingerprint);

        // NO DEDUPLICATION BY FINGERPRINT. Two creators may legitimately
        // register visually similar images; adjudicating that on chain is out
        // of scope. Resolution returns all candidates ordered by block.
        emit ManifestRegistered(recordId, msg.sender, fingerprint, keccak256(manifest), manifest);
    }
}
