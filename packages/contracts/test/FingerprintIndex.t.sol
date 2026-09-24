// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {IFingerprintIndex} from "../src/interfaces/IFingerprintIndex.sol";
import {IGrainRegistry} from "../src/interfaces/IGrainRegistry.sol";

contract FingerprintIndexTest is Base {
    /// THE CORRECTNESS PROOF for the 8x8 band geometry.
    ///
    /// Pigeonhole: 7 flipped bits spread across 8 bands must leave at least one
    /// band untouched, so a candidate query on all 8 bands is guaranteed to
    /// contain every true match at Hamming distance <= 7. This is why
    /// MATCH_THRESHOLD is 7 and why 4 bands of 16 bits would not do -- that
    /// geometry only guarantees recall to distance 3.
    function test_LshRecall_1000Records_AllRecalledWithin7Bits() public {
        uint64[] memory fps = new uint64[](1000);

        for (uint256 i = 0; i < 1000; i++) {
            fps[i] = uint64(uint256(keccak256(abi.encode("fp", i))));
            _register(ana, fps[i], _manifest(4));
        }

        for (uint256 i = 0; i < 1000; i++) {
            uint64 query = fps[i];
            uint256 flips = 1 + (uint256(keccak256(abi.encode("n", i))) % 7); // 1..7
            for (uint256 f = 0; f < flips; f++) {
                uint256 bit = uint256(keccak256(abi.encode("bit", i, f))) % 64;
                query ^= uint64(1) << uint64(bit);
            }

            assertTrue(_candidatesContain(query, uint64(i + 1)), "recall failure within distance 7");
        }
    }

    function _candidatesContain(uint64 query, uint64 wanted) internal view returns (bool) {
        for (uint8 band = 0; band < 8; band++) {
            uint8 value = uint8(query >> (8 * (7 - band)));
            uint64[] memory bucket = index.queryBand(band, value, 0, 512);
            for (uint256 j = 0; j < bucket.length; j++) {
                if (bucket[j] == wanted) return true;
            }
        }
        return false;
    }

    function test_Verify_ReturnsHammingDistanceFromChain() public {
        uint64 fp = 0x0F0F0F0F0F0F0F0F;
        uint64 id = _register(ana, fp, _manifest(8));

        assertEq(index.verify(id, fp), 0, "identical fingerprint is distance 0");
        assertEq(index.verify(id, fp ^ 0x01), 1);
        assertEq(index.verify(id, fp ^ 0xFF), 8);
        assertEq(index.verify(id, ~fp), 64, "inverse differs in every bit");
    }

    function test_Verify_RevertsForUnknownRecord() public {
        vm.expectRevert(abi.encodeWithSelector(IGrainRegistry.UnknownRecord.selector, uint64(7)));
        index.verify(7, 0);
    }

    function test_OnlyRegistryCanInsert() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IFingerprintIndex.NotRegistry.selector, bob));
        index.insert(1, 1);
    }

    function test_RegistryCannotBeRepointed() public {
        vm.expectRevert(abi.encodeWithSignature("RegistryAlreadySet()"));
        index.setRegistry(IGrainRegistry(address(0xdead)));
    }

    function test_BandOutOfRangeReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IFingerprintIndex.BandOutOfRange.selector, uint8(8)));
        index.queryBand(8, 0, 0, 10);
        vm.expectRevert(abi.encodeWithSelector(IFingerprintIndex.BandOutOfRange.selector, uint8(8)));
        index.bandSize(8, 0);
    }

    function test_QueryBandPaginates() public {
        // All five share band 0, so they land in one bucket.
        for (uint64 i = 0; i < 5; i++) _register(ana, (uint64(0xAB) << 56) | i, _manifest(4));

        assertEq(index.bandSize(0, 0xAB), 5);
        assertEq(index.queryBand(0, 0xAB, 0, 2).length, 2);
        assertEq(index.queryBand(0, 0xAB, 4, 10).length, 1, "limit clamps to the bucket end");
        assertEq(index.queryBand(0, 0xAB, 99, 10).length, 0, "offset past the end returns empty");
    }

    function test_BandsIsEight() public view {
        assertEq(index.BANDS(), 8);
    }
}
