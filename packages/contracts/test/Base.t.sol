// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {GrainRegistry} from "../src/GrainRegistry.sol";
import {FingerprintIndex} from "../src/FingerprintIndex.sol";
import {CreatorRegistry} from "../src/CreatorRegistry.sol";
import {LicenseRegistry} from "../src/LicenseRegistry.sol";
import {IGrainRegistry} from "../src/interfaces/IGrainRegistry.sol";
import {IFingerprintIndex} from "../src/interfaces/IFingerprintIndex.sol";
import {ICreatorRegistry} from "../src/interfaces/ICreatorRegistry.sol";

abstract contract Base is Test {
    GrainRegistry internal registry;
    FingerprintIndex internal index;
    CreatorRegistry internal creators;
    LicenseRegistry internal licenses;

    address internal ana = makeAddr("ana");
    address internal bob = makeAddr("bob");

    function setUp() public virtual {
        index = new FingerprintIndex();
        registry = new GrainRegistry(IFingerprintIndex(address(index)));
        index.setRegistry(IGrainRegistry(address(registry)));
        creators = new CreatorRegistry();
        licenses = new LicenseRegistry(IGrainRegistry(address(registry)), ICreatorRegistry(address(creators)));
    }

    /// @dev Registration is a two-step dance by design: read the id, then
    ///      register against it. See IGrainRegistry.register.
    function _register(address who, uint64 fingerprint, bytes memory manifest) internal returns (uint64 id) {
        uint64 expected = registry.nextRecordId();
        vm.prank(who);
        return registry.register(expected, fingerprint, manifest);
    }

    function _manifest(uint256 size) internal pure returns (bytes memory m) {
        m = new bytes(size);
        for (uint256 i = 0; i < size; i++) m[i] = bytes1(uint8(0x41 + (i % 26)));
    }
}
