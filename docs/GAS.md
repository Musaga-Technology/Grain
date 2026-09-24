# Gas — measured

Foundry, Solidity 0.8.26, measured 24 Sep 2026 by `packages/contracts/test/Gas.t.sol`.
Reproduce with:

```
cd packages/contracts && forge test --match-contract GasTest -vv
```

These numbers are the evidence behind the claim that per-asset onchain
registration is economically real. They are measured, not estimated.

## Registration

| Manifest | Cold buckets | Warm buckets |
|---|---|---|
| 256 B | 443,438 | **86,108** |
| 1 KB | 443,017 | **92,903** |
| 4 KB | 470,643 | 120,108 |
| 16 KB | 582,848 | 229,290 |

**Cold** is a fingerprint whose eight LSH buckets are all empty, so each push
initialises a fresh storage slot. **Warm** is the same fingerprint again, where
the buckets exist and the pushes extend arrays.

The gap is the story. Cold registration is dominated not by the manifest but by
the eight bucket initialisations — note that 256 B and 1 KB cost almost the
same. Once the index is populated, registration drops to about 86–93k, and a
populated index is the steady state: there are only 2,048 buckets, so the first
few hundred records warm nearly all of them.

**Manifest size is close to free** in the warm case — 16 KB costs 2.7x a 256 B
manifest while carrying 64x the data. That is the event-data decision in SPEC
§6.1 paying off: log data is 8 gas per byte against 20,000 for a cold storage
slot.

## Reads

| Call | Gas |
|---|---|
| `FingerprintIndex.verify()` | **8,687** |
| `FingerprintIndex.queryBand()`, 1 entry | 5,684 |

`verify()` is the one that matters for the pitch. Independently confirming a
resolution result against the chain — the "verify on chain" button in the UI —
costs under 9,000 gas. That is the difference between Grain and a database: a
sceptic can check the answer without trusting whoever served it.

## Seeding

Projected from the measured warm and cold figures, 256 B manifests, assuming
the first ~256 records pay cold and the remainder warm:

| Corpus | Gas | Testnet MON @ 50 gwei |
|---|---|---|
| 5,000 | 522,016,480 | ~26 |
| 10,000 | 952,556,480 | ~48 |
| 25,000 | 2,244,176,480 | ~112 |

Testnet MON has no monetary value; the constraint is faucet throughput, not
cost. An earlier estimate of ~209k gas per registration was made before the
contracts existed and was roughly double the warm figure.
