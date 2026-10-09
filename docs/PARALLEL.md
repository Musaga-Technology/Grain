# Registration under Monad's parallel execution — measured

Monad executes transactions optimistically in parallel. Two transactions that
touch the same storage slot conflict, and the later one is re-executed after the
earlier. That is always correct, but a design where *every* transaction touches
one slot gets no parallelism at all. This is what we found in Grain's own
registry, how we measured it on Monad testnet, and what changes.

## The bottleneck in v1

`GrainRegistry` (the live registry) hands out record ids from **one global
counter**, `nextRecordId`. Every `register()` reads and writes it, so every
registration conflicts with every other one.

It is worse than re-execution. A creator's browser reads the counter, embeds
that id in the image's invisible watermark, and only then sends the
transaction, so the contract checks the id it was given
(`UnexpectedRecordId`): a watermark must never point at someone else's record.
Two creators registering in the same block both read the same id; the first
lands, the second is refused.

## The burst test

[`scripts/burst-test.ts`](../scripts/burst-test.ts) against throwaway
deployments ([`DeployBurst.s.sol`](../packages/contracts/script/DeployBurst.s.sol)),
never the live registry. Twenty fresh accounts each register once, every
transaction pre-signed and sent at the same instant, as twenty creators pressing
"Register" together would. Run on 9 Oct 2026; raw results in
[`evidence/burst-2026-10-09-16-34.json`](evidence/burst-2026-10-09-16-34.json).

| | Sent | Landed | Reverted | Blocks | Time |
|---|---|---|---|---|---|
| **v1**, everyone at once | 20 | **1** | 19 | 2 | 1.1 s |
| **v1**, the refused retry | 19 | **1** | 18 | 3 | 1.1 s |
| **v2** `reserve()` | 20 | 20 | 0 | 1 | 1.5 s |
| **v2**, everyone at once | 20 | **20** | 0 | 2 | 0.9 s |

The v1 reverts are id collisions, not something else: the counter ended at 3
(exactly two registrations), replaying a round-one call returns
`UnexpectedRecordId(1, 3)`, and v2 did the same index work under the same gas
limit with no failures. At v1's rate, twenty simultaneous creators need twenty
rounds. Under v2 they all land in two blocks.

## What changed in the live app

The register page now survives a collision: when the counter has moved past the
id it tried, it re-marks the image with the new id and sends again, up to three
times. That makes v1 correct under contention, one creator per round, but not
parallel.

## v2: ranges instead of a counter

[`GrainRegistryV2`](../packages/contracts/src/v2/GrainRegistryV2.sol): each
creator calls `reserve(count)` once, the only call that touches the shared
counter, and receives a range of ids. `register()` then takes the next id of the
caller's own range, writing only the caller's range and the new record. Creators
never share a slot, so their registrations neither conflict nor collide, and the
watermark still knows its id before the transaction is sent. 8 Foundry tests.

The fingerprint index is unchanged. Its eight bucket appends conflict only when
two images share a band value, and a conflict there costs a re-execution, never
a refusal.

**Not live yet, deliberately.** Every image registered so far carries a v1 record
id in its watermark, and the record pages, indexer and samples are keyed to the
v1 contract. Moving means deploying v2 alongside v1, pointing new registrations
at it, keeping v1 readable for existing marks, and indexing both in Envio. That
is a migration to do after the hackathon, not three days before it.

## Two Monad behaviours this surfaced

- **Cold storage costs more than on Ethereum.** A registration into an empty
  index estimated at ~439k gas in Foundry costs ~580k on Monad testnet, because
  writing a storage slot for the first time is priced higher. The live registry
  is warm: about 93k. Monad also charges the full gas limit, not the gas used,
  so limits have to be tight estimates.
- **The reserve balance.** A value transfer may not take the sender below its
  10 MON reserve unless it is the sender's only transaction in the last three
  blocks ([Monad docs](https://docs.monad.xyz/developer-essentials/reserve-balance)).
  The first burst runs funded their test accounts with back-to-back transfers,
  and most of those reverted, so the funding step now spaces transfers three
  blocks apart and confirms each. The live faucet had the same exposure, since
  it holds less than 10 MON and every grant is a transfer; it now spaces grants
  the same way and retries one that reverts.
