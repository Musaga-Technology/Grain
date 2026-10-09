// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {GrainRegistry} from "../src/GrainRegistry.sol";
import {GrainRegistryV2} from "../src/v2/GrainRegistryV2.sol";
import {FingerprintIndex} from "../src/FingerprintIndex.sol";
import {IGrainRegistry} from "../src/interfaces/IGrainRegistry.sol";
import {IFingerprintIndex} from "../src/interfaces/IFingerprintIndex.sol";

/// Throwaway deployments for the parallel-execution burst test
/// (scripts/burst-test.ts, docs/PARALLEL.md). Never the live registry.
contract DeployBurst is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        FingerprintIndex i1 = new FingerprintIndex();
        GrainRegistry v1 = new GrainRegistry(IFingerprintIndex(address(i1)));
        i1.setRegistry(IGrainRegistry(address(v1)));
        FingerprintIndex i2 = new FingerprintIndex();
        GrainRegistryV2 v2 = new GrainRegistryV2(IFingerprintIndex(address(i2)));
        i2.setRegistry(IGrainRegistry(address(v2)));
        vm.stopBroadcast();
        console.log("V1", address(v1));
        console.log("V2", address(v2));
    }
}
