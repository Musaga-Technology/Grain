# Indexer — measured

Envio HyperIndex over the Monad testnet deployment. Measured 25 Sep 2026
against a registry holding **506 records**, all of them indexed.

## What it is for

A read accelerator, not a source of truth. SPEC §7 requires the resolver to
keep answering with this switched off, and it does — the chain-read path is
built first and stays the one that is always correct. What the indexer removes
is round trips.

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
- Handler callbacks type-check as `any` under a standalone `tsc` run even
  though the `Global` augmentation resolves correctly. It is an inference quirk
  in `onEvent`, not a defect: the handlers are exercised by all 506 records
  being indexed with correct creators, fingerprints, transaction hashes and
  band rows.
