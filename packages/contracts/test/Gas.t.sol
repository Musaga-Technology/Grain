// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {console} from "forge-std/console.sol";

/// Measures registration cost directly rather than reading it off a snapshot
/// that includes setup. These numbers go in the README: the argument for a
/// per-asset onchain registry rests on them being measured, not asserted.
contract GasTest is Base {
    function test_Gas_RegisterByManifestSize() public {
        uint256[4] memory sizes = [uint256(256), 1024, 4096, 16384];
        console.log("manifest bytes | register gas | warm-bucket gas");

        for (uint256 i = 0; i < sizes.length; i++) {
            bytes memory m = _manifest(sizes[i]);

            // Cold: every LSH bucket this fingerprint touches is empty, so each
            // of the 8 pushes pays for a fresh slot. This is the honest number
            // for an early registry.
            uint64 expected = registry.nextRecordId();
            uint64 fp = uint64(uint256(keccak256(abi.encode("cold", i))));
            vm.prank(ana);
            uint256 g0 = gasleft();
            registry.register(expected, fp, m);
            uint256 cold = g0 - gasleft();

            // Warm: same fingerprint again, so all 8 buckets already exist and
            // the pushes extend arrays rather than initialising them. This is
            // what a populated registry actually costs.
            expected = registry.nextRecordId();
            vm.prank(bob);
            g0 = gasleft();
            registry.register(expected, fp, m);
            uint256 warm = g0 - gasleft();

            console.log(sizes[i], cold, warm);
        }
    }

    function test_Gas_ReadPaths() public {
        uint64 fp = 0x0102030405060708;
        uint64 id = _register(ana, fp, _manifest(512));

        uint256 g0 = gasleft();
        index.verify(id, fp);
        console.log("verify() gas:", g0 - gasleft());

        g0 = gasleft();
        index.queryBand(0, 0x01, 0, 100);
        console.log("queryBand() gas (1 entry):", g0 - gasleft());
    }
}
