# Resolver — measured

C2PA Soft Binding Resolution API over the live Monad testnet deployment.
Measured 24 Sep 2026 against a registry holding **506 records**.

## Verified behaviour

All four states, against the deployed contracts rather than a fixture:

| Input | State | Via | Distance |
|---|---|---|---|
| The registered PNG | `RESOLVED` | **both** | 0 |
| A JPEG Q20 copy of it | `RESOLVED` | **fingerprint** | 0 |
| An unregistered image | `NOT_FOUND` | — | — |
| Record 1's watermark on a different photo | **`TAMPERED`** | — | 30 |

The middle two rows are the argument for the architecture, live. The same
photograph resolves through *both* paths as a PNG and through the *fingerprint
alone* once crushed to JPEG Q20 — the watermark does not survive that, exactly
as the robustness matrix predicted at 43% recovery.

The last row is the anti-spoof cross-check. TrustMark payloads are not
authenticated, so anyone can embed any recordId into any image; what makes the
claim checkable is the fingerprint stored in the manifest.

## Latency profile

**End to end, warm: 1.0-1.6 s.** SPEC §8.2 targets under two seconds.

Getting there took three fixes, each found by profiling rather than guessing:

| Stage | Latency |
|---|---|
| First measurement | 11.6 s |
| Multicall batching on candidate reads | 3.2-3.8 s |
| **Long-lived TrustMark daemon** | **1.0-1.6 s** |

Component timings on a 1280x1600 PNG:

| Component | CLI | Daemon |
|---|---|---|
| TrustMark decode | 2.0-2.8 s | **0.33-0.61 s** |
| Image decode + fingerprint | 0.58 s | 0.58 s |
| 8 LSH band queries | 0.98 s | 0.98 s |
| 34 candidate record reads | 0.22 s (batched) | 0.22 s |

**The candidate reads were one RPC round trip per record.** Batched through
Multicall3 they are 0.22 s for 34 records, down from roughly ten seconds. The
latency was never the chain, it was the round trips.

**The watermark decode was a model load, not a decode.** The `trustmark` CLI
reads a 45 MB ONNX decoder from disk on every invocation. `packages/trustmarkd`
holds it in a resident process and speaks newline-delimited JSON, which keeps
the resolver in TypeScript and avoids an FFI binding. Same model, same answer,
four to six times faster.

**The two paths overlap.** The watermark decode needs only the raw bytes, so it
starts without waiting for the fingerprint.

Worth stating plainly: **all chain work totals 1.2 seconds against a 506-record
registry**, and the candidate fan-out is what the Envio indexer removes. What
remained after that was startup cost, not consensus.
