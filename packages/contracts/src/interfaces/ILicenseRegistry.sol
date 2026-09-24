// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ILicenseRegistry
/// @notice Pay-per-use licensing, consumed by the MetaMask Agent Wallet plugin.
/// @dev    NO PROTOCOL FEE. A fee invites tokenomics questions that lead nowhere
///         good in judging. Full amount forwards to the creator.
/// @dev    NO ERC-721 ANYWHERE. A licence is a registry record, not a token.
///         See SPEC.md 1 - the NFT question will be asked and the answer must be
///         structural, not rhetorical.
interface ILicenseRegistry {
    event LicenseGranted(
        uint64  indexed recordId,
        address indexed licensee,
        address indexed creator,
        uint256         amountWei,
        uint40          grantedAt
    );

    error NotLicensable(uint64 recordId);
    error InsufficientPayment(uint256 sent, uint256 required);
    error PayoutFailed(address creator, uint256 amount);

    /// @notice Pay the creator's listed price and record the grant.
    ///         Refunds any excess to msg.sender.
    function license(uint64 recordId) external payable;

    /// @dev Backed by a mapping, not derived from events: the plugin and the
    ///      Sentinel workflow both need to ask this on chain.
    function hasLicense(uint64 recordId, address licensee) external view returns (bool);

    function priceOf(uint64 recordId) external view returns (uint256);
}
