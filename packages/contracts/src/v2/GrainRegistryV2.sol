// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IGrainRegistry} from "../interfaces/IGrainRegistry.sol";
import {IFingerprintIndex} from "../interfaces/IFingerprintIndex.sol";

/// @title GrainRegistryV2 -- registration without a shared counter
/// @notice The registry v1 hands out record ids from one global counter, so
///         every registration reads and writes the same storage slot. Monad
///         executes transactions in parallel, and two transactions touching
///         one slot conflict and are re-executed one after the other. Worse,
///         a creator embeds the id in the image's watermark before sending,
///         so two creators registering in the same block collide and one is
///         refused. Measured in docs/PARALLEL.md.
/// @dev    V2 gives each creator a range of ids, reserved once. The shared
///         counter is touched only by reserve(); register() writes the
///         creator's own range and the new record, so registrations by
///         different creators share no counter and never collide. The
///         fingerprint index is unchanged: bucket appends conflict only when
///         two images share a band value, and a conflict there only costs a
///         re-execution, never a refusal.
contract GrainRegistryV2 {
    uint256 public constant MAX_MANIFEST_BYTES = 16 * 1024;
    uint32 public constant MAX_RANGE = 1_000;

    struct Range {
        uint64 next; // the id this creator's next registration must use
        uint64 end; // exclusive
    }

    IFingerprintIndex public immutable index;
    uint64 public nextFreeId = 1; // 0 is the null id; touched only by reserve()
    mapping(address => Range) public rangeOf;
    mapping(uint64 => IGrainRegistry.Record) private _records;

    event RangeReserved(address indexed creator, uint64 first, uint32 count);
    event ManifestRegistered(
        uint64 indexed recordId, address indexed creator, uint64 fingerprint, bytes32 manifestHash, bytes manifest
    );

    error BadRangeSize(uint32 count);
    error NotYourNextId(uint64 given, uint64 expected);
    error ManifestTooLarge(uint256 length, uint256 max);

    constructor(IFingerprintIndex index_) {
        index = index_;
    }

    /// @notice Reserve `count` ids for the caller. Replaces any unused range.
    function reserve(uint32 count) external returns (uint64 first) {
        if (count == 0 || count > MAX_RANGE) revert BadRangeSize(count);
        first = nextFreeId;
        nextFreeId = first + count;
        rangeOf[msg.sender] = Range({next: first, end: first + count});
        emit RangeReserved(msg.sender, first, count);
    }

    /// @notice Register with the next id of the caller's own range -- the id
    ///         the caller already embedded in the watermark.
    function register(uint64 recordId, uint64 fingerprint, bytes calldata manifest) external returns (uint64) {
        if (manifest.length > MAX_MANIFEST_BYTES) revert ManifestTooLarge(manifest.length, MAX_MANIFEST_BYTES);
        Range storage r = rangeOf[msg.sender];
        if (recordId != r.next || r.next >= r.end) revert NotYourNextId(recordId, r.next);
        r.next = recordId + 1;

        _records[recordId] = IGrainRegistry.Record({
            creator: msg.sender,
            fingerprint: fingerprint,
            manifestHash: keccak256(manifest),
            // forge-lint: disable-next-line(unsafe-typecast)
            registeredAt: uint40(block.timestamp),
            supersededBy: 0,
            revoked: false
        });
        index.insert(recordId, fingerprint);
        emit ManifestRegistered(recordId, msg.sender, fingerprint, keccak256(manifest), manifest);
        return recordId;
    }

    function records(uint64 recordId) external view returns (IGrainRegistry.Record memory) {
        return _records[recordId];
    }
}
