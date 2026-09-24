// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IFingerprintIndex} from "./interfaces/IFingerprintIndex.sol";
import {IGrainRegistry} from "./interfaces/IGrainRegistry.sol";

/// @title FingerprintIndex
/// @notice Locality-sensitive hashing over 64-bit perceptual hashes, on chain.
///
/// BAND GEOMETRY - 8 bands x 8 bits. Pigeonhole: if two fingerprints differ in
/// at most 7 bits, at least one of the 8 bands is identical, so the candidate
/// set provably contains every true match at Hamming distance <= 7. That is
/// why MATCH_THRESHOLD is 7 and cannot be raised.
contract FingerprintIndex is IFingerprintIndex {
    uint8 private constant _BANDS = 8;

    IGrainRegistry public registry;
    address private immutable _deployer;

    mapping(uint8 band => mapping(uint8 value => uint64[] recordIds)) private _buckets;

    error RegistryAlreadySet();
    error NotDeployer(address caller);

    constructor() {
        _deployer = msg.sender;
    }

    /// @dev The registry needs this contract's address at construction and this
    ///      contract needs the registry's, so one link is made after the fact.
    ///      One-time and deployer-only, so it cannot be repointed later.
    function setRegistry(IGrainRegistry registry_) external {
        if (msg.sender != _deployer) revert NotDeployer(msg.sender);
        if (address(registry) != address(0)) revert RegistryAlreadySet();
        registry = registry_;
    }

    function insert(uint64 recordId, uint64 fingerprint) external {
        if (msg.sender != address(registry)) revert NotRegistry(msg.sender);
        unchecked {
            for (uint8 band = 0; band < _BANDS; band++) {
                _buckets[band][_bandValue(fingerprint, band)].push(recordId);
            }
        }
    }

    function queryBand(uint8 band, uint8 value, uint256 offset, uint256 limit)
        external
        view
        returns (uint64[] memory recordIds)
    {
        if (band >= _BANDS) revert BandOutOfRange(band);
        uint64[] storage bucket = _buckets[band][value];
        if (offset >= bucket.length) return new uint64[](0);

        uint256 end = offset + limit;
        if (end > bucket.length) end = bucket.length;
        recordIds = new uint64[](end - offset);
        unchecked {
            for (uint256 i = offset; i < end; i++) recordIds[i - offset] = bucket[i];
        }
    }

    function bandSize(uint8 band, uint8 value) external view returns (uint256) {
        if (band >= _BANDS) revert BandOutOfRange(band);
        return _buckets[band][value].length;
    }

    /// @notice Onchain proof of a resolution result. The UI's "verify on chain"
    ///         button calls this, so a sceptic can confirm the indexer is not
    ///         lying without trusting the resolver or the indexer.
    function verify(uint64 recordId, uint64 queryFingerprint) external view returns (uint8 distance) {
        IGrainRegistry.Record memory r = registry.records(recordId);
        if (r.creator == address(0)) revert IGrainRegistry.UnknownRecord(recordId);
        return _hamming(r.fingerprint, queryFingerprint);
    }

    function BANDS() external pure returns (uint8) {
        return _BANDS;
    }

    /// @dev Band 0 is the most significant byte, matching grain-core's toBands.
    function _bandValue(uint64 fingerprint, uint8 band) internal pure returns (uint8) {
        unchecked {
            // forge-lint: disable-next-line(unsafe-typecast)
            // Truncation is the operation: a band IS the low byte after shifting.
            return uint8(fingerprint >> (8 * (7 - band)));
        }
    }

    /// @dev Kernighan popcount over the XOR: loops once per differing bit
    ///      rather than 64 times, and the interesting queries are near matches.
    function _hamming(uint64 a, uint64 b) internal pure returns (uint8 d) {
        uint64 x = a ^ b;
        unchecked {
            while (x != 0) {
                x &= x - 1;
                d++;
            }
        }
    }
}
