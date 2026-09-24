// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ILicenseRegistry} from "./interfaces/ILicenseRegistry.sol";
import {ICreatorRegistry} from "./interfaces/ICreatorRegistry.sol";
import {IGrainRegistry} from "./interfaces/IGrainRegistry.sol";

/// @title LicenseRegistry
/// @notice Pay-per-use licensing, consumed by the MetaMask Agent Wallet plugin.
/// @dev    NO PROTOCOL FEE. The full amount forwards to the creator; a fee
///         invites tokenomics questions that lead nowhere good.
/// @dev    NO ERC-721 ANYWHERE. A licence is a registry record, not a token.
contract LicenseRegistry is ILicenseRegistry {
    IGrainRegistry public immutable registry;
    ICreatorRegistry public immutable creatorRegistry;

    mapping(uint64 => mapping(address => bool)) private _licensed;

    constructor(IGrainRegistry registry_, ICreatorRegistry creatorRegistry_) {
        registry = registry_;
        creatorRegistry = creatorRegistry_;
    }

    function license(uint64 recordId) external payable {
        IGrainRegistry.Record memory r = registry.records(recordId);
        if (r.creator == address(0)) revert IGrainRegistry.UnknownRecord(recordId);

        uint256 price = creatorRegistry.creators(r.creator).licensePriceWei;
        if (price == 0) revert NotLicensable(recordId);
        if (msg.value < price) revert InsufficientPayment(msg.value, price);

        // Effects before interactions: the grant is recorded before any value
        // moves, so a creator whose receiving contract re-enters cannot observe
        // a half-written state.
        _licensed[recordId][msg.sender] = true;
        emit LicenseGranted(recordId, msg.sender, r.creator, price, uint40(block.timestamp));

        (bool paid,) = r.creator.call{value: price}("");
        if (!paid) revert PayoutFailed(r.creator, price);

        uint256 excess = msg.value - price;
        if (excess != 0) {
            (bool refunded,) = msg.sender.call{value: excess}("");
            if (!refunded) revert PayoutFailed(msg.sender, excess);
        }
    }

    function hasLicense(uint64 recordId, address licensee) external view returns (bool) {
        return _licensed[recordId][licensee];
    }

    function priceOf(uint64 recordId) external view returns (uint256) {
        IGrainRegistry.Record memory r = registry.records(recordId);
        if (r.creator == address(0)) return 0;
        return creatorRegistry.creators(r.creator).licensePriceWei;
    }
}
