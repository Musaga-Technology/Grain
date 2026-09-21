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

Recovery rate = fraction of the 20 images where the watermark decoded correctly.
Distance = median Hamming distance between the original and transformed fingerprint.

| Transformation | WM recovery | FP distance | Resolves? | Notes |
|---|---|---|---|---|
| None (control) | | 0 | | |
| Screenshot (OS tool) | | | | |
| JPEG Q40 | | | | |
| JPEG Q20 | | | | |
| Downscale 50% | | | | |
| Downscale 25% | | | | |
| Crop 10% | | | | |
| Crop 25% | | | | |
| Instagram-style filter | | | | |
| Gaussian blur | | | | |
| Real platform round-trip | | | | name the platform |
| Screenshot + JPEG Q40 | | | | worst realistic case |

## Thresholds derived from the above

| Constant | Value | Justification |
|---|---|---|
| `MATCH_THRESHOLD` | _default 7_ | Must stay <= 7 or the 8x8 LSH band geometry no longer guarantees recall |
| `TAMPER_THRESHOLD` | _default 12_ | Above this with a valid watermark = transferred mark |
| `MAX_RECORD_ID` | | from measured payload width |

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
