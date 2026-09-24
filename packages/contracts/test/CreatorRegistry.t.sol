// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {ICreatorRegistry} from "../src/interfaces/ICreatorRegistry.sol";

contract CreatorRegistryTest is Base {
    function test_SetAndReadProfile() public {
        vm.prank(ana);
        creators.setProfile("ana-ruiz", "https://ana.example", 2 ether);

        ICreatorRegistry.Creator memory c = creators.creators(ana);
        assertEq(c.handle, "ana-ruiz");
        assertEq(c.profileURI, "https://ana.example");
        assertEq(c.licensePriceWei, 2 ether);
        assertEq(creators.handleOwner(keccak256(bytes("ana-ruiz"))), ana);
    }

    function test_HandleCannotBeStolen() public {
        vm.prank(ana);
        creators.setProfile("ana-ruiz", "", 0);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ICreatorRegistry.HandleTaken.selector, "ana-ruiz"));
        creators.setProfile("ana-ruiz", "", 0);
    }

    function test_OwnerCanUpdateTheirOwnHandle() public {
        vm.startPrank(ana);
        creators.setProfile("ana-ruiz", "", 1);
        creators.setProfile("ana-ruiz", "https://new", 5); // same handle, new data
        assertEq(creators.creators(ana).licensePriceWei, 5);

        // Changing handle releases the old one rather than reserving it forever.
        creators.setProfile("ana-r", "", 5);
        vm.stopPrank();

        assertEq(creators.handleOwner(keccak256(bytes("ana-ruiz"))), address(0));
        vm.prank(bob);
        creators.setProfile("ana-ruiz", "", 0);
        assertEq(creators.handleOwner(keccak256(bytes("ana-ruiz"))), bob);
    }

    function test_RejectsMalformedHandles() public {
        string[7] memory bad = ["ab", "Ana-Ruiz", "ana ruiz", "ana_ruiz", "-ana", "ana-", "ana.ruiz"];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.prank(ana);
            vm.expectRevert(abi.encodeWithSelector(ICreatorRegistry.InvalidHandle.selector, bad[i]));
            creators.setProfile(bad[i], "", 0);
        }
    }

    function test_RejectsHandleOver30Chars() public {
        string memory long = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"; // 32
        vm.prank(ana);
        vm.expectRevert(abi.encodeWithSelector(ICreatorRegistry.InvalidHandle.selector, long));
        creators.setProfile(long, "", 0);
    }
}
