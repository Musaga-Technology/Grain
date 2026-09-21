# Robustness matrix

**Fill this in during Milestone 0 (20-22 Sep), before writing any product code.**
Everything downstream — thresholds, watermark strength, demo narration — depends on
these measurements. Do not guess them.

## Environment

| Item | Value |
|---|---|
| TrustMark variant | Q (default, PSNR 43-45 dB) |
| TrustMark encoding | _BCH_5 / BCH_SUPER — record which_ |
| **Usable payload bits** | _MEASURE THIS FIRST — it sets MAX_RECORD_ID_ |
| `WM_STRENGTH` | _highest value with no visible ripple, by eye_ |
| Browser / ONNX runtime version | |
| Test image set | 20 images: 5 photo, 5 illustration, 5 AI-generated, 5 screenshot-of-text |

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
