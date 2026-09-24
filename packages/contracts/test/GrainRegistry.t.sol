// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {IGrainRegistry} from "../src/interfaces/IGrainRegistry.sol";
import {Vm} from "forge-std/Vm.sol";

contract GrainRegistryTest is Base {
    function test_RoundTrip_ManifestHashMatches() public {
        bytes memory m = _manifest(512);
        uint64 id = _register(ana, 0xDEADBEEFCAFEBABE, m);

        IGrainRegistry.Record memory r = registry.records(id);
        assertEq(id, 1, "first id is 1, 0 is the null id");
        assertEq(r.creator, ana);
        assertEq(r.fingerprint, 0xDEADBEEFCAFEBABE);
        assertEq(r.manifestHash, keccak256(m), "manifest hash must survive the round trip");
        assertEq(r.supersededBy, 0);
        assertFalse(r.revoked);
    }

    function test_IdsAreSequentialAndStartAtOne() public {
        assertEq(registry.nextRecordId(), 1);
        assertEq(_register(ana, 1, _manifest(8)), 1);
        assertEq(_register(bob, 2, _manifest(8)), 2);
        assertEq(registry.nextRecordId(), 3);
    }

    /// The watermark carries the recordId and is embedded BEFORE registration,
    /// so a racing registration must fail loudly rather than bind that
    /// watermark to someone else's record.
    function test_RevertsWhenSomeoneElseTakesTheId() public {
        uint64 expected = registry.nextRecordId();
        _register(bob, 99, _manifest(8)); // bob lands first

        vm.prank(ana);
        vm.expectRevert(abi.encodeWithSelector(IGrainRegistry.UnexpectedRecordId.selector, expected, expected + 1));
        registry.register(expected, 100, _manifest(8));
    }

    function test_ManifestIsInEventDataNotStorage() public {
        bytes memory m = _manifest(1024);
        vm.recordLogs();
        uint64 id = _register(ana, 7, m);

        // The full manifest is recoverable from the log, which is the only
        // place it exists -- storage holds the hash alone.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        (uint64 fp, bytes32 h, bytes memory emitted) = abi.decode(logs[0].data, (uint64, bytes32, bytes));
        assertEq(fp, 7);
        assertEq(h, keccak256(m));
        assertEq(emitted, m, "full CBOR must be in the event");
        assertEq(registry.records(id).manifestHash, keccak256(m));
    }

    function test_RevertsOnOversizeManifest() public {
        uint256 max = registry.MAX_MANIFEST_BYTES();
        _register(ana, 1, _manifest(max)); // exactly at the cap is fine

        uint64 expected = registry.nextRecordId();
        vm.prank(ana);
        vm.expectRevert(abi.encodeWithSelector(IGrainRegistry.ManifestTooLarge.selector, max + 1, max));
        registry.register(expected, 2, _manifest(max + 1));
    }

    /// Deliberate design position, not an oversight: two creators may
    /// legitimately register visually similar images.
    function test_DoesNotDeduplicateByFingerprint() public {
        uint64 a = _register(ana, 0xABCD, _manifest(8));
        uint64 b = _register(bob, 0xABCD, _manifest(8));
        assertTrue(a != b);
        assertEq(registry.records(a).creator, ana);
        assertEq(registry.records(b).creator, bob);
    }

    function test_Supersede_LinksAndRequiresCreator() public {
        uint64 first = _register(ana, 1, _manifest(8));

        uint64 expected = registry.nextRecordId();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IGrainRegistry.NotCreator.selector, first, bob));
        registry.supersede(first, expected, 2, _manifest(8));

        vm.prank(ana);
        uint64 second = registry.supersede(first, expected, 2, _manifest(8));
        assertEq(registry.records(first).supersededBy, second);
        assertEq(registry.records(second).supersededBy, 0);
    }

    function test_Revoke_RequiresCreatorAndIsIdempotentlyRejected() public {
        uint64 id = _register(ana, 1, _manifest(8));

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IGrainRegistry.NotCreator.selector, id, bob));
        registry.revoke(id);

        vm.prank(ana);
        registry.revoke(id);
        assertTrue(registry.records(id).revoked);

        vm.prank(ana);
        vm.expectRevert(abi.encodeWithSelector(IGrainRegistry.AlreadyRevoked.selector, id));
        registry.revoke(id);
    }

    function test_UnknownRecordReverts() public {
        vm.prank(ana);
        vm.expectRevert(abi.encodeWithSelector(IGrainRegistry.UnknownRecord.selector, uint64(42)));
        registry.revoke(42);
    }
}
