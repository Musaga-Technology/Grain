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

The chain is not the bottleneck. Component timings on a 1280x1600 PNG:

| Component | Time |
|---|---|
| **TrustMark decode** (CLI spawn + 45 MB model load, per request) | **2.0–2.8 s** |
| Image decode + fingerprint | 0.58 s |
| 8 LSH band queries | 0.98 s |
| 34 candidate record reads, batched | **0.22 s** |

End to end, warm: **3.2–3.8 s**. SPEC §8.2 targets under two seconds.

Two fixes already applied:

- **Multicall batching.** The candidate reads were one RPC round trip per
  record. Batched through Multicall3 they are 0.22 s for 34 records, down from
  roughly ten seconds. The latency was never the chain, it was the round trips.
- **Overlapping the two paths.** The watermark decode needs only the raw bytes,
  so it starts immediately instead of waiting for the fingerprint.

## The remaining bottleneck, and the fix

**Every request spawns the TrustMark CLI, which loads a 45 MB ONNX model from
disk before decoding anything.** That is 2 seconds of the 3.2, and it is pure
startup cost — the decode itself is fast.

The fix is a persistent decoder that loads the model once: either a long-running
process the resolver talks to, or `onnxruntime-node` pinned to 1.17.3, the last
release shipping a `darwin/x64` binary. Either should bring a resolve
comfortably under the two-second target, since everything else already sums to
about 1.2 s.

Worth stating plainly: **all chain work totals 1.2 seconds against a 506-record
registry**, and the candidate fan-out is what the Envio indexer is meant to
remove. The remaining cost is a model load, not consensus.
