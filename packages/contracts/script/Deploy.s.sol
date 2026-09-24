// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {GrainRegistry} from "../src/GrainRegistry.sol";
import {FingerprintIndex} from "../src/FingerprintIndex.sol";
import {CreatorRegistry} from "../src/CreatorRegistry.sol";
import {LicenseRegistry} from "../src/LicenseRegistry.sol";
import {IGrainRegistry} from "../src/interfaces/IGrainRegistry.sol";
import {IFingerprintIndex} from "../src/interfaces/IFingerprintIndex.sol";
import {ICreatorRegistry} from "../src/interfaces/ICreatorRegistry.sol";

/// Deploy order is forced: the registry needs the index's address at
/// construction, and the index needs the registry's. The index is deployed
/// first and linked afterwards through a one-time, deployer-only setter.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        FingerprintIndex index = new FingerprintIndex();
        GrainRegistry registry = new GrainRegistry(IFingerprintIndex(address(index)));
        index.setRegistry(IGrainRegistry(address(registry)));
        CreatorRegistry creators = new CreatorRegistry();
        LicenseRegistry licenses =
            new LicenseRegistry(IGrainRegistry(address(registry)), ICreatorRegistry(address(creators)));

        vm.stopBroadcast();

        console.log("FingerprintIndex", address(index));
        console.log("GrainRegistry   ", address(registry));
        console.log("CreatorRegistry ", address(creators));
        console.log("LicenseRegistry ", address(licenses));
    }
}
