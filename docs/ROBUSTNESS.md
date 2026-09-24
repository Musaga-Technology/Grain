# Robustness matrix

**Fill this in during Milestone 0 (20-22 Sep), before writing any product code.**
Everything downstream — thresholds, watermark strength, demo narration — depends on
these measurements. Do not guess them.

## Environment

| Item | Value |
|---|---|
| TrustMark variant | Q (default, PSNR 43-45 dB) |
| TrustMark encoding | **BCH_SUPER** — see below |
| **Usable payload bits** | **40** → `MAX_RECORD_ID = 2^40 - 1 = 1,099,511,627,775` |
| `WM_STRENGTH` | _highest value with no visible ripple, by eye — NOT YET MEASURED_ |
| Encode implementation | TrustMark Rust crate 0.2.2 (`ort` ONNX runtime) |
| Decode implementation | TrustMark JS/ONNX |
| Browser / ONNX runtime version | _pending_ |
| Test image set | 20 images: 5 photo, 5 illustration, 5 AI-generated, 5 screenshot-of-text — _not yet supplied_ |

### Payload width — measured, not quoted

Read from the Rust implementation's `src/bits.rs` rather than from documentation.
Total payload is 100 bits, of which 4 encode the version:

| Version | Data bits | ECC bits | Correctable bit flips |
|---|---|---|---|
| **BCH_SUPER** | **40** | 56 | **8** |
| BCH_5 | 61 | 35 | 5 |
| BCH_4 | 68 | 28 | 4 |
| BCH_3 | 75 | 21 | 3 |

**BCH_SUPER is chosen.** A recordId needs nowhere near 40 bits at any plausible
scale — 2^40 is 1.1 trillion — so capacity is not the scarce resource and
robustness is. BCH_SUPER corrects 8 bit flips against BCH_5's 5.

Consequence for the registry: `recordId` is a `uint64` on chain, but only the
low 40 bits fit in a watermark. Registration must refuse to issue a watermark
above `MAX_RECORD_ID`; such a record still resolves by fingerprint, but silently
shipping an unwatermarkable id would break the watermark path with no error.

### Round-trip validated — 21 Sep

TrustMark Rust crate 0.2.2, release build, Intel Mac (macOS 13.7, x86_64).
`cargo build --release` takes ~10 minutes cold.

| Measurement | Value |
|---|---|
| Encode, 512×512 PNG | ~1.8 s |
| Decode, 512×512 PNG | ~1.0 s |
| CLI default BCH version | `BchSuper` — matches our choice |

`MAX_RECORD_ID` confirmed empirically, not just read from source. recordIds
`1`, `12345`, `2^40 - 2` and `2^40 - 1` all encode and decode back exactly.

### Watermarking shifts the fingerprint by 2 bits

Measured on `ghost.png` (512×512), three different payloads:

| recordId | Hamming distance, original → watermarked |
|---|---|
| 1 | 2 |
| 12345 | 2 |
| 1,099,511,627,775 | 2 |

Identical across payloads, so the shift comes from the residual itself rather
than from what is encoded — expected for spread-spectrum embedding.

**This settles the registration ordering question.** Two bits of a seven-bit
budget is 29%, consumed before any real-world transformation. Registering the
*original* image's fingerprint and then distributing the *watermarked* file
would give every legitimate asset a permanent handicap, and the anti-spoof
cross-check in SPEC §2 compares against the watermark-bearing asset — so the
registered fingerprint must be the watermarked one.

Consequence: the watermark must be embedded before the fingerprint is computed,
which means the recordId must be known before registration. Hence
`register(expectedRecordId, fingerprint, manifest)`, reverting on mismatch.

**n = 1 image.** The distribution across the 20-image set is still needed.

### Model sizes — measured

Fetched from `https://cai-watermark.adobe.net/watermarking/trustmark-models`,
byte-verified against `Content-Length`.

| Model | Bytes | Size |
|---|---|---|
| `decoder_Q.onnx` | 47,401,222 | 45.2 MB |
| `encoder_Q.onnx` | 17,312,208 | 16.5 MB |
| `decoder_C.onnx` (compact variant) | 22,457,887 | 21.4 MB |

**This does not affect the browser.** SPEC §7 already routes the web app's
verification through `POST /v1/resolve`, so both models load once server-side
and the browser ships no ONNX at all. The fingerprint runs client-side and needs
no model — it is arithmetic over a committed DCT table.

Variant C's decoder is less than half the size of Q's, which would matter only
if watermark decoding ever had to move into the browser. It would be a
pipeline-wide change: images encoded with one variant cannot be decoded with
another, and Q was chosen for robustness.

### Implementation split — correction to SPEC.md §5.2

SPEC §5.2 declares `embed()` and `decode()` as though both run in the browser,
and §8.4 step 5 says the watermark is embedded in-browser. **That is not
possible.** The official TrustMark JavaScript build is **decode-only**
(adobe/trustmark README, `/js`). Encoding requires the Rust crate.

- **decode** → JS/ONNX, in the browser. This is the verify path, and decode is
  exactly what that build supports.
- **encode** → Rust crate, server-side. Registration therefore cannot be purely
  client-side.

Watermark **removal** is not implemented in Rust either. Act 3 of the demo
re-embeds a recordId into a different image rather than lifting a mark off a
registered one — which is the more honest attack regardless, since TrustMark
payloads are unauthenticated and anyone can forge one. That is precisely what
the fingerprint cross-check exists to catch.

> TrustMark docs note that even 40 bits gives a key space of around a trillion, so
> capacity is not the constraint — but the exact width decides the recordId type.
> Raising WM_STRENGTH to 1.5 improves robustness enough to survive printing at the
> cost of ripple artifacts. Lowering to 0.8 still survives low noise, screenshotting
> and social media. Find the ceiling that stays invisible on YOUR demo images.

## Results

Measured 24 Sep 2026 over **21 fixtures** (10 photo, 6 illustration, 5 screenshot)
by `scripts/robustness-matrix.ts`. Reproduce with:

```
node --experimental-strip-types scripts/robustness-matrix.ts
```

The reference fingerprint is taken from the **watermarked** file, not the
original, because that is what the anti-spoof check compares against (SPEC §2).

"Resolves" is the better of the two paths — which is the whole point of having
two.

| Transformation | WM recovery | FP dist (median / max) | FP within 7 | Resolves | Note |
|---|---|---|---|---|---|
| none (control) | 100% | 0 / 0 | 100% | **100%** |  |
| screenshot | 100% | 0 / 0 | 100% | **100%** |  |
| JPEG Q40 | 76% | 0 / 2 | 100% | **100%** | fingerprint carries it |
| JPEG Q20 | 43% | 0 / 4 | 100% | **100%** | fingerprint carries it |
| downscale 50% | 100% | 0 / 2 | 100% | **100%** |  |
| downscale 25% | 100% | 0 / 2 | 100% | **100%** |  |
| crop 10% | 100% | 12 / 28 | 19% | **100%** | watermark carries it; fingerprint does not |
| crop 25% | 19% | 24 / 34 | 0% | **19%** | **both paths fail** |
| social filter | 43% | 2 / 8 | 95% | **95%** | fingerprint carries it |
| gaussian blur s=1.5 | 100% | 0 / 2 | 100% | **100%** |  |
| screenshot+JPEG Q40 | 71% | 0 / 2 | 100% | **100%** |  |

Real platform round-trip is not automated and still needs a manual pass.

### What this says

**The two paths are genuinely complementary, and the data shows it.** JPEG Q20
drops watermark recovery to 43% while the fingerprint is untouched at distance
0. Cropping inverts it: at 10% the watermark survives every time and the
fingerprint moves a median of 12. Neither path is a fallback for the other;
they fail in different directions, which is exactly the argument in SPEC §2.

**Crop 25% defeats both.** 19% resolve. The watermark is centre-cropped away
and the fingerprint lands at median 24 — inside the range where unrelated
images sit (minimum 18 across 210 pairs). This is not a threshold that can be
tuned around; at that distance the image genuinely is a different image as far
as a 64-bit global DCT hash is concerned. `docs/DEMO.md` had a crop-25% beat
and it has been corrected.

**TrustMark is more robust to scaling than the literature suggested.** 100%
recovery at both 50% and 25% downscale, against the ~82% an independent
evaluation reported. Blur at sigma 1.5 also recovered 100%.

**Embedding barely moves the fingerprint.** Median 0, maximum 4 of the 7-bit
budget. An earlier single-image measurement suggested 2 bits was typical; over
21 fixtures the median is 0.

## Thresholds derived from the above

| Constant | Value | Justification |
|---|---|---|
| `MATCH_THRESHOLD` | **7** | Unchanged. Cannot go higher — the 8x8 band geometry only guarantees recall to 7. |
| `TAMPER_THRESHOLD` | **16** (was 12) | See below. |
| `MAX_RECORD_ID` | **2^40 - 1** | BCH_SUPER payload width. |

### TAMPER_THRESHOLD raised from 12 to 16

At 12, **7 of 21 legitimate 10% crops would be reported as TAMPERED** — a third
of people who crop their own photograph told they are passing off someone
else's credentials. The alarm state firing on innocent content is a worse
failure than missing an attack, and in a live demo it is fatal.

Separation measured over 210 unrelated fixture pairs: minimum 18, 1st
percentile 22, median 32.

| T | Crops falsely flagged | Genuine transfers missed |
|---|---|---|
| 12 | 7 / 21 | 0 / 210 |
| **16** | **2 / 21** | **0 / 210** |
| 20 | 1 / 21 | 2 / 210 |
| 28 | 0 / 21 | 63 / 210 |

16 is where false accusations nearly vanish and no genuine transfer escapes.
Re-derive if the fingerprint changes.

## Aspect-ratio caveat

TrustMark generates residuals at 256x256 and scales them into the image, and
auto-centre-crops when the aspect ratio exceeds 2.0, which degrades the watermark on
very long or thin images. Detect ratio > 2.0 at registration, warn in plain language,
lean on the fingerprint path.

## Mera check (same milestone)

- [ ] PRF working on the demo browser AND the demo device
- [ ] `PRF_UNAVAILABLE` reproduced deliberately on desktop Chrome saving to the local
      profile instead of Google Password Manager, so the error copy is tested
- [ ] Recovery verified: clear site data, sign in on phone, everything returns

## Decision gate

**If watermark recovery on screenshots is under ~50%: that is fine.** The fingerprint
path is co-equal by design (SPEC.md 2), so this changes the demo narration, not the
architecture. Update `docs/DEMO.md` and carry on. Do not redesign.
