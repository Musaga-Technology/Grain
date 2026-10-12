// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {GrainRegistry} from "../src/GrainRegistry.sol";
import {FingerprintIndex} from "../src/FingerprintIndex.sol";
import {CreatorRegistry} from "../src/CreatorRegistry.sol";
import {LicenseRegistry} from "../src/LicenseRegistry.sol";
import {IGrainRegistry} from "../src/interfaces/IGrainRegistry.sol";
import {ILicenseRegistry} from "../src/interfaces/ILicenseRegistry.sol";
import {Test} from "forge-std/Test.sol";

/// Fuzz tests: properties that must hold for any input, not just the examples
/// in the unit tests.
contract FuzzTest is Base {
    function _popcount(uint64 x) internal pure returns (uint8 n) {
        for (uint256 i = 0; i < 64; i++) {
            if ((x >> i) & 1 == 1) n++;
        }
    }

    /// verify() is exactly the Hamming distance, for every pair of fingerprints.
    function testFuzz_VerifyIsHammingDistance(uint64 registered, uint64 query) public {
        uint64 id = _register(ana, registered, _manifest(16));
        assertEq(index.verify(id, query), _popcount(registered ^ query));
        assertEq(index.verify(id, registered), 0, "a record is always distance 0 from its own fingerprint");
    }

    /// Every record is findable in each of its 8 band buckets.
    function testFuzz_RecordIsInEveryBand(uint64 fp) public {
        uint64 id = _register(ana, fp, _manifest(16));
        for (uint8 b = 0; b < 8; b++) {
            uint8 value = uint8(fp >> (56 - 8 * uint256(b)));
            uint64[] memory ids = index.queryBand(b, value, 0, 50);
            bool found;
            for (uint256 i = 0; i < ids.length; i++) {
                if (ids[i] == id) found = true;
            }
            assertTrue(found, "record missing from a band bucket");
        }
    }

    /// The contract stores the hash of exactly the bytes the creator signed.
    function testFuzz_ManifestHashRoundTrip(bytes calldata manifest) public {
        vm.assume(manifest.length <= 16 * 1024);
        uint64 expected = registry.nextRecordId();
        vm.prank(ana);
        uint64 id = registry.register(expected, 42, manifest);
        assertEq(registry.records(id).manifestHash, keccak256(manifest));
    }

    /// Nobody but the creator can withdraw a record.
    function testFuzz_OnlyCreatorRevokes(address other) public {
        vm.assume(other != ana);
        uint64 id = _register(ana, 7, _manifest(8));
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(IGrainRegistry.NotCreator.selector, id, other));
        registry.revoke(id);
    }

    /// A licence pays the creator exactly their price, refunds any excess, and
    /// leaves nothing in the contract.
    function testFuzz_LicenceForwardsExactlyThePrice(uint96 price, uint96 overpay) public {
        vm.assume(price > 0);
        vm.prank(ana);
        creators.setProfile("ana", "", price);
        uint64 id = _register(ana, 9, _manifest(8));

        address buyer = makeAddr("buyer");
        uint256 sent = uint256(price) + overpay;
        vm.deal(buyer, sent);
        uint256 creatorBefore = ana.balance;
        vm.prank(buyer);
        licenses.license{value: sent}(id);

        assertEq(ana.balance - creatorBefore, price, "creator receives exactly the price");
        assertEq(buyer.balance, overpay, "the excess comes back");
        assertEq(address(licenses).balance, 0, "the contract keeps nothing");
        assertTrue(licenses.hasLicense(id, buyer));
    }

    function testFuzz_LicenceRefusesUnderpayment(uint96 price, uint96 short) public {
        vm.assume(price > 0 && short > 0 && short <= price);
        vm.prank(ana);
        creators.setProfile("ana", "", price);
        uint64 id = _register(ana, 9, _manifest(8));
        address buyer = makeAddr("buyer");
        vm.deal(buyer, price);
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                ILicenseRegistry.InsufficientPayment.selector, uint256(price) - short, uint256(price)
            )
        );
        licenses.license{value: uint256(price) - short}(id);
    }
}

/// Drives the contracts through random sequences of real actions, so the
/// invariants below are checked after every step of every sequence.
contract Handler is Test {
    GrainRegistry public registry;
    FingerprintIndex public index;
    CreatorRegistry public creators;
    LicenseRegistry public licenses;

    address[3] public actors = [address(0xA11CE), address(0xB0B), address(0xCA401)];
    uint64[] public ids;
    mapping(uint64 => uint64) public fingerprintOf;
    mapping(uint64 => bool) public everRevoked;
    uint256 public writes;

    constructor(GrainRegistry r, FingerprintIndex i, CreatorRegistry c, LicenseRegistry l) {
        registry = r;
        index = i;
        creators = c;
        licenses = l;
        string[3] memory handles = ["alice", "bob", "carol"];
        for (uint256 k = 0; k < 3; k++) {
            vm.prank(actors[k]);
            creators.setProfile(handles[k], "", 1 ether / (k + 1));
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function register(uint256 who, uint64 fp) external {
        address a = actors[who % 3];
        uint64 expected = registry.nextRecordId();
        vm.prank(a);
        uint64 id = registry.register(expected, fp, hex"a1b2c3");
        ids.push(id);
        fingerprintOf[id] = fp;
        writes++;
    }

    function supersede(uint256 pick, uint64 fp) external {
        if (ids.length == 0) return;
        uint64 old = ids[pick % ids.length];
        IGrainRegistry.Record memory r = registry.records(old);
        if (r.revoked || r.supersededBy != 0) return;
        uint64 expected = registry.nextRecordId();
        vm.prank(r.creator);
        uint64 id = registry.supersede(old, expected, fp, hex"d4e5");
        ids.push(id);
        fingerprintOf[id] = fp;
        writes++;
    }

    function revoke(uint256 pick) external {
        if (ids.length == 0) return;
        uint64 id = ids[pick % ids.length];
        IGrainRegistry.Record memory r = registry.records(id);
        if (r.revoked) return;
        vm.prank(r.creator);
        registry.revoke(id);
        everRevoked[id] = true;
    }

    function license(uint256 pick, uint256 buyerSeed) external {
        if (ids.length == 0) return;
        uint64 id = ids[pick % ids.length];
        uint256 price = licenses.priceOf(id);
        address buyer = address(uint160(uint256(keccak256(abi.encode(buyerSeed))) | 1 << 150));
        vm.deal(buyer, price + 1 ether);
        vm.prank(buyer);
        licenses.license{value: price + 0.5 ether}(id);
    }
}

contract InvariantTest is Base {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(registry, index, creators, licenses);
        targetContract(address(handler));
    }

    /// Ids are handed out one at a time, from 1, with no gaps.
    function invariant_IdsAreSequential() public view {
        assertEq(registry.nextRecordId(), 1 + handler.writes());
    }

    /// Every record ever written stays verifiable: distance 0 from its own
    /// fingerprint, and present in all 8 band buckets.
    function invariant_IndexMatchesRecords() public view {
        uint256 n = handler.idsLength();
        for (uint256 i = 0; i < n; i++) {
            uint64 id = handler.ids(i);
            uint64 fp = handler.fingerprintOf(id);
            assertEq(registry.records(id).fingerprint, fp);
            assertEq(index.verify(id, fp), 0);
            for (uint8 b = 0; b < 8; b++) {
                uint256 size = index.bandSize(b, uint8(fp >> (56 - 8 * uint256(b))));
                assertGt(size, 0, "a record's band bucket can't be empty");
            }
        }
    }

    /// Withdrawal is permanent, and a supersede only ever points forward.
    function invariant_RevocationAndSupersedeAreOneWay() public view {
        uint256 n = handler.idsLength();
        for (uint256 i = 0; i < n; i++) {
            uint64 id = handler.ids(i);
            IGrainRegistry.Record memory r = registry.records(id);
            if (handler.everRevoked(id)) assertTrue(r.revoked, "a revoked record came back");
            if (r.supersededBy != 0) assertGt(r.supersededBy, id, "supersede must point to a newer record");
            assertTrue(r.creator != address(0));
        }
    }

    /// Every licence payment is forwarded in the same call.
    function invariant_LicenceRegistryHoldsNothing() public view {
        assertEq(address(licenses).balance, 0);
    }
}
