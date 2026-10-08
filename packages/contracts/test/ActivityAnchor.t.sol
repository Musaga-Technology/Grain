// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ActivityAnchor} from "../src/ActivityAnchor.sol";

contract ActivityAnchorTest is Test {
    ActivityAnchor anchor;
    address sealer = makeAddr("sealer");
    uint64 constant GENESIS = 1_790_000_000;

    function setUp() public {
        vm.warp(GENESIS + 1 days);
        anchor = new ActivityAnchor(sealer, GENESIS);
    }

    function test_GenesisSealIsEmpty() public view {
        ActivityAnchor.Seal memory s = anchor.latest();
        assertEq(anchor.sealCount(), 1);
        assertEq(s.until, GENESIS);
        assertEq(s.events, 0);
        assertEq(s.root, keccak256(""));
    }

    function test_WindowsAreContiguous() public {
        vm.startPrank(sealer);
        anchor.seal(GENESIS + 100, 3, keccak256("a"));
        anchor.seal(GENESIS + 500, 1, keccak256("b"));
        vm.stopPrank();
        ActivityAnchor.Seal memory first = anchor.seals(1);
        ActivityAnchor.Seal memory second = anchor.seals(2);
        assertEq(first.from, GENESIS);
        assertEq(first.until, GENESIS + 100);
        assertEq(second.from, GENESIS + 100); // starts exactly where the last ended
        assertEq(second.until, GENESIS + 500);
        assertEq(second.root, keccak256("b"));
    }

    function test_EmitsSealed() public {
        vm.expectEmit(true, false, false, true);
        emit ActivityAnchor.Sealed(1, GENESIS, GENESIS + 100, 2, keccak256("x"));
        vm.prank(sealer);
        anchor.seal(GENESIS + 100, 2, keccak256("x"));
    }

    function test_OnlySealer() public {
        vm.expectRevert(ActivityAnchor.NotSealer.selector);
        anchor.seal(GENESIS + 100, 0, bytes32(0));
    }

    function test_CannotRewriteOrOverlapHistory() public {
        vm.startPrank(sealer);
        anchor.seal(GENESIS + 100, 1, keccak256("a"));
        vm.expectRevert(abi.encodeWithSelector(ActivityAnchor.WindowNotAfterLastSeal.selector, GENESIS + 100, GENESIS + 100));
        anchor.seal(GENESIS + 100, 2, keccak256("forged"));
        vm.expectRevert(abi.encodeWithSelector(ActivityAnchor.WindowNotAfterLastSeal.selector, GENESIS + 50, GENESIS + 100));
        anchor.seal(GENESIS + 50, 0, keccak256("backdated"));
        vm.stopPrank();
        assertEq(anchor.seals(1).root, keccak256("a"));
    }

    function test_CannotSealTheFuture() public {
        vm.prank(sealer);
        vm.expectRevert(abi.encodeWithSelector(ActivityAnchor.WindowInFuture.selector, uint64(block.timestamp + 1)));
        anchor.seal(uint64(block.timestamp + 1), 0, bytes32(0));
    }

    function test_SealGas() public {
        vm.prank(sealer);
        uint256 before = gasleft();
        anchor.seal(GENESIS + 100, 7, keccak256("a"));
        emit log_named_uint("seal() gas", before - gasleft());
    }
}
