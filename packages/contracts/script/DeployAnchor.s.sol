// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {ActivityAnchor} from "../src/ActivityAnchor.sol";

/// Deploys the activity log's anchor. Separate from Deploy.s.sol: the registry
/// contracts are already live and must not be redeployed.
contract DeployAnchor is Script {
    function run() external {
        address sealer = vm.envAddress("ANCHOR_SEALER");
        uint64 genesis = uint64(vm.envUint("ANCHOR_GENESIS"));
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        ActivityAnchor anchor = new ActivityAnchor(sealer, genesis);
        vm.stopBroadcast();
        console.log("ActivityAnchor  ", address(anchor));
    }
}
