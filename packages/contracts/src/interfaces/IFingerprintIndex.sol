// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IFingerprintIndex
/// @notice Locality-sensitive hashing for approximate nearest-neighbour search
///         over 64-bit perceptual hashes, on chain.
///
/// BAND GEOMETRY - 8 bands x 8 bits.
/// Pigeonhole: if two fingerprints differ in at most 7 bits, at least one of the
/// 8 bands is identical, so the candidate set provably contains every true match
/// at Hamming distance <= 7. That matches MATCH_THRESHOLD in grain-core.
/// 4 bands x 16 bits would only guarantee recall to distance 3 - too tight for
/// real-world re-encoding. This bound is proved by the LSH recall test
/// (1,000 fingerprints, <=7 bits flipped, 100% recall required).
///
/// KNOWN SCALING LIMIT - state it openly in the README rather than being caught:
/// 8-bit bands give 256 buckets per band, so at 1M records a bucket averages
/// ~3,900 ids and reading one on chain gets expensive. Correct at hackathon
/// scale. Production path: multi-index hashing with wider bands, plus offchain
/// fan-out with onchain verification - which is what the resolver already does.
interface IFingerprintIndex {
    error NotRegistry(address caller);
    error BandOutOfRange(uint8 band);

    /// @notice Called by GrainRegistry during register/supersede.
    function insert(uint64 recordId, uint64 fingerprint) external;

    /// @notice Paginated read of one LSH bucket.
    function queryBand(uint8 band, uint8 value, uint256 offset, uint256 limit)
        external view returns (uint64[] memory recordIds);

    function bandSize(uint8 band, uint8 value) external view returns (uint256);

    /// @notice Onchain proof of a resolution result. The UI's "verify on chain"
    ///         button calls this so a sceptic can confirm the indexer isn't lying.
    /// @return distance Hamming distance between stored and query fingerprints.
    function verify(uint64 recordId, uint64 queryFingerprint)
        external view returns (uint8 distance);

    function BANDS() external view returns (uint8); // 8
}
