// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICreatorRegistry} from "./interfaces/ICreatorRegistry.sol";

/// @title CreatorRegistry
/// @notice Creator handles and licence pricing.
/// @dev    DELIBERATELY SEPARATE FROM CONTENT RECORDS. The C2PA specification
///         does not address human or organisational identity - it covers the
///         provenance of the content itself, for privacy reasons. Grain mirrors
///         that separation rather than folding identity into the record.
contract CreatorRegistry is ICreatorRegistry {
    uint256 private constant MIN_HANDLE = 3;
    uint256 private constant MAX_HANDLE = 30;

    mapping(address => Creator) private _creators;
    mapping(bytes32 => address) private _handleOwner;

    function setProfile(string calldata handle, string calldata profileURI, uint256 licensePriceWei) external {
        if (!_validHandle(handle)) revert InvalidHandle(handle);

        bytes32 h = keccak256(bytes(handle));
        address owner = _handleOwner[h];
        if (owner != address(0) && owner != msg.sender) revert HandleTaken(handle);

        // Release the previous handle so it does not stay reserved forever.
        string memory previous = _creators[msg.sender].handle;
        if (bytes(previous).length != 0) {
            bytes32 ph = keccak256(bytes(previous));
            if (ph != h) delete _handleOwner[ph];
        }

        _handleOwner[h] = msg.sender;
        _creators[msg.sender] = Creator({handle: handle, profileURI: profileURI, licensePriceWei: licensePriceWei});

        emit ProfileSet(msg.sender, handle, licensePriceWei);
    }

    /// @dev Explicit rather than a public mapping. An auto-getter returns three
    ///      separate top-level values, which is a different ABI encoding from a
    ///      struct return, so ICreatorRegistry would not decode against it.
    function creators(address creator) external view returns (Creator memory) {
        return _creators[creator];
    }

    function handleOwner(bytes32 handleHash) external view returns (address) {
        return _handleOwner[handleHash];
    }

    /// @dev Lowercase [a-z0-9-], 3-30 chars. Enforced on chain because the
    ///      handle appears in the UI as a person's name and a display that can
    ///      be spoofed by case or whitespace is a provenance problem.
    function _validHandle(string calldata handle) internal pure returns (bool) {
        bytes memory b = bytes(handle);
        if (b.length < MIN_HANDLE || b.length > MAX_HANDLE) return false;
        if (b[0] == "-" || b[b.length - 1] == "-") return false;

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-";
            if (!ok) return false;
        }
        return true;
    }
}
