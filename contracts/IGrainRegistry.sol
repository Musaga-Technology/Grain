// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IGrainRegistry
/// @notice Onchain C2PA manifest repository. Records are keyed by a sequential
///         uint64 recordId because that id must fit inside a TrustMark watermark
///         payload (see SPEC.md 5.2 — capacity is measured in Milestone 0).
/// @dev    Manifests live in EVENT DATA, not contract storage. Storage holds only
///         the hash. Event data is permanent chain history; contract storage would
///         only add contract-readable access that nothing in this system needs.
interface IGrainRegistry {
    struct Record {
        address creator;        // msg.sender at registration
        uint64  fingerprint;    // 64-bit perceptual hash (grain.phash.v1)
        bytes32 manifestHash;   // keccak256 of the CBOR manifest
        uint40  registeredAt;   // block.timestamp
        uint64  supersededBy;   // 0 when current
        bool    revoked;
    }

    event ManifestRegistered(
        uint64  indexed recordId,
        address indexed creator,
        uint64          fingerprint,
        bytes32         manifestHash,
        bytes           manifest      // full CBOR - event-only, never stored
    );
    event ManifestSuperseded(uint64 indexed oldId, uint64 indexed newId);
    event ManifestRevoked(uint64 indexed recordId);

    error ManifestTooLarge(uint256 length, uint256 max); // max 16 KB
    error NotCreator(uint64 recordId, address caller);
    error UnknownRecord(uint64 recordId);
    error AlreadyRevoked(uint64 recordId);

    /// @notice Register a new manifest. Assigns the next recordId, writes the
    ///         Record, calls FingerprintIndex.insert, emits ManifestRegistered.
    /// @dev    NO DEDUPLICATION BY FINGERPRINT. Two creators may legitimately
    ///         register similar images; adjudicating that on chain is out of
    ///         scope. Resolution returns all candidates ordered by block.
    function register(uint64 fingerprint, bytes calldata manifest)
        external returns (uint64 recordId);

    /// @notice Register a new version of an existing record (an edit).
    function supersede(uint64 oldId, uint64 fingerprint, bytes calldata manifest)
        external returns (uint64 newId);

    function revoke(uint64 recordId) external;

    function records(uint64 recordId) external view returns (Record memory);
    function nextRecordId() external view returns (uint64);
}
