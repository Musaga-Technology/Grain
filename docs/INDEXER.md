# Indexer — measured

Envio HyperIndex over the Monad testnet deployment. Measured 25 Sep 2026
against a registry holding **506 records**, all of them indexed.

## What it is for

The app's primary read path — and never its source of truth. Every answer the
indexer gives is either checked against the contract or has a chain fallback,
so a wrong or stale index cannot change a verdict, and the product keeps
working with it switched off (SPEC §7).

| Where | What the indexer does | Without it |
|---|---|---|
| Verify | the LSH candidate fan-out, one query | 8 chain reads, ~11x slower |
| Record page `/r/:id` | returns the manifest, block and tx in one query; the manifest is hashed and compared with the hash the contract stores | a log search over a 100-block window |
| Creator page `/c/:handle` | every record under a name | **not possible** — the contracts cannot list a creator's records without a full scan; the page says the listing is unavailable |
| Landing, "Recently registered" | the latest records and registry totals | **not possible** without a full scan; the section is left out |

The last two are why the indexer is part of the product rather than an
optimisation: "what has this person made" and "what was registered recently"
have no cheap answer on chain at all.

The app reads `NEXT_PUBLIC_ENVIO_GRAPHQL_URL`; every query has a 4 s timeout
and returns null on any failure, which is what triggers the fallback.

## The candidate fan-out

Resolving by fingerprint means finding every record sharing any of the query's
8 LSH band values. Against the chain that is 8 separate `queryBand` calls.

| Path | Fan-out |
|---|---|
| Chain reads, 8 band queries | **980 ms** |
| Envio, one GraphQL query | **90 ms** |

Both return the identical 34 candidates for the same fingerprint. That is
roughly 11x on the single slowest remaining piece of a resolve.

## Why bands are rows, not an array column

The obvious schema puts the 8 band values in an array column on `Record` and
queries it with an overlap operator. The research notes flagged that operator's
availability as an open question, so the schema avoids needing it: each band
value is its own row keyed `band:value`, and the fan-out becomes a single
indexed `key_in` lookup over 8 keys — a plain B-tree hit rather than an array
scan.

`revoked` is denormalised onto the band rows so a fan-out can filter without
joining back to `Record`.

## Notes

- `field_selection.transaction_fields: [hash]` is required. Transaction hashes
  are not delivered otherwise, and a record page needs one so a person can
  follow a registration to the chain themselves.
- The record page shows which path served it ("Found via"), so the trust
  model is visible rather than asserted.
- Handler callbacks type-check as `any` under a standalone `tsc` run even
  though the `Global` augmentation resolves correctly. It is an inference quirk
  in `onEvent`, not a defect: the handlers are exercised by all 506 records
  being indexed with correct creators, fingerprints, transaction hashes and
  band rows.
