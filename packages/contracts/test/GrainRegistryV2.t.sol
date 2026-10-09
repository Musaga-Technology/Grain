// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {GrainRegistryV2} from "../src/v2/GrainRegistryV2.sol";
import {FingerprintIndex} from "../src/FingerprintIndex.sol";
import {IGrainRegistry} from "../src/interfaces/IGrainRegistry.sol";
import {IFingerprintIndex} from "../src/interfaces/IFingerprintIndex.sol";

contract GrainRegistryV2Test is Test {
    GrainRegistryV2 reg;
    FingerprintIndex index;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        index = new FingerprintIndex();
        reg = new GrainRegistryV2(IFingerprintIndex(address(index)));
        index.setRegistry(IGrainRegistry(address(reg)));
    }

    function test_CreatorsGetSeparateRanges() public {
        vm.prank(alice);
        uint64 a = reg.reserve(10);
        vm.prank(bob);
        uint64 b = reg.reserve(10);
        assertEq(a, 1);
        assertEq(b, 11);
    }

    function test_RegistrationsOfDifferentCreatorsDoNotInterfere() public {
        vm.prank(alice);
        reg.reserve(10);
        vm.prank(bob);
        reg.reserve(10);
        // Interleaved in any order -- neither depends on the other's progress.
        vm.prank(bob);
        reg.register(11, 0xBEEF, "b1");
        vm.prank(alice);
        reg.register(1, 0xA1, "a1");
        vm.prank(alice);
        reg.register(2, 0xA2, "a2");
        vm.prank(bob);
        reg.register(12, 0xBEF0, "b2");
        assertEq(reg.records(1).creator, alice);
        assertEq(reg.records(12).creator, bob);
        assertEq(reg.nextFreeId(), 21, "register() never touches the shared counter");
    }

    function test_CannotUseSomeoneElsesId() public {
        vm.prank(alice);
        reg.reserve(10);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(GrainRegistryV2.NotYourNextId.selector, 1, 0));
        reg.register(1, 0x1, "x");
    }

    function test_IdsMustBeUsedInOrder() public {
        vm.prank(alice);
        reg.reserve(10);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GrainRegistryV2.NotYourNextId.selector, 2, 1));
        reg.register(2, 0x1, "x");
    }

    function test_ExhaustedRangeIsRefused() public {
        vm.startPrank(alice);
        reg.reserve(1);
        reg.register(1, 0x1, "x");
        vm.expectRevert(abi.encodeWithSelector(GrainRegistryV2.NotYourNextId.selector, 2, 2));
        reg.register(2, 0x2, "y");
        vm.stopPrank();
    }

    function test_BadRangeSizes() public {
        vm.expectRevert(abi.encodeWithSelector(GrainRegistryV2.BadRangeSize.selector, 0));
        reg.reserve(0);
        vm.expectRevert(abi.encodeWithSelector(GrainRegistryV2.BadRangeSize.selector, 1001));
        reg.reserve(1001);
    }

    function test_RecordsLandInTheSharedIndex() public {
        vm.startPrank(alice);
        reg.reserve(5);
        reg.register(1, 0x1122334455667788, "x");
        vm.stopPrank();
        assertEq(index.verify(1, 0x1122334455667788), 0);
    }

    function test_RegisterGas() public {
        vm.startPrank(alice);
        reg.reserve(5);
        uint256 g = gasleft();
        reg.register(1, 0x1122334455667788, "manifest");
        emit log_named_uint("v2 register() gas, cold index", g - gasleft());
        vm.stopPrank();
    }
}
