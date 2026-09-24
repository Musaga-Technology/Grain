// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {ILicenseRegistry} from "../src/interfaces/ILicenseRegistry.sol";
import {IGrainRegistry} from "../src/interfaces/IGrainRegistry.sol";

contract LicenseRegistryTest is Base {
    uint64 internal recordId;

    function setUp() public override {
        super.setUp();
        vm.prank(ana);
        creators.setProfile("ana-ruiz", "", 2 ether);
        recordId = _register(ana, 0xAAAA, _manifest(64));
        vm.deal(bob, 10 ether);
    }

    function test_ExactPayment_ForwardsEverythingToCreator() public {
        uint256 before = ana.balance;

        vm.prank(bob);
        licenses.license{value: 2 ether}(recordId);

        assertEq(ana.balance - before, 2 ether, "no protocol fee: creator gets the full amount");
        assertEq(address(licenses).balance, 0, "contract holds nothing");
        assertTrue(licenses.hasLicense(recordId, bob));
    }

    function test_OverpaymentIsRefunded() public {
        uint256 creatorBefore = ana.balance;
        uint256 payerBefore = bob.balance;

        vm.prank(bob);
        licenses.license{value: 3 ether}(recordId);

        assertEq(ana.balance - creatorBefore, 2 ether);
        assertEq(payerBefore - bob.balance, 2 ether, "excess returns to the payer");
    }

    function test_UnderpaymentReverts() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ILicenseRegistry.InsufficientPayment.selector, 1 ether, 2 ether));
        licenses.license{value: 1 ether}(recordId);
    }

    function test_UnpricedRecordReverts() public {
        // carol registers but never sets a licence price. bob is the funded
        // payer throughout, so the revert under test is the price check rather
        // than an out-of-funds failure.
        address carol = makeAddr("carol");
        uint64 unpriced = _register(carol, 0xBBBB, _manifest(8));

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ILicenseRegistry.NotLicensable.selector, unpriced));
        licenses.license{value: 1 ether}(unpriced);
    }

    function test_UnknownRecordReverts() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IGrainRegistry.UnknownRecord.selector, uint64(999)));
        licenses.license{value: 2 ether}(999);
    }

    function test_PriceOf() public view {
        assertEq(licenses.priceOf(recordId), 2 ether);
        assertEq(licenses.priceOf(999), 0, "unknown record is simply unpriced");
    }

    function test_EmitsLicenseGranted() public {
        vm.expectEmit(true, true, true, true);
        emit ILicenseRegistry.LicenseGranted(recordId, bob, ana, 2 ether, uint40(block.timestamp));
        vm.prank(bob);
        licenses.license{value: 2 ether}(recordId);
    }
}
