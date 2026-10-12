# Real images, a real platform, a real C2PA checker

C2PA credentials live inside the image file. Any re-encode drops them: a
platform's compression, a screenshot, even Grain's own watermarking. This is
what that looks like for seven real ChatGPT images, and what Grain recovers.
Run on 12 Oct 2026; raw results in
[`evidence/survival-2026-10-12/`](evidence/survival-2026-10-12/).

## Method

1. **Seven images generated in ChatGPT**, downloaded as files. Adobe's
   [c2patool](https://github.com/contentauth/c2pa-rs) 0.27.22 finds OpenAI's
   C2PA manifest in all seven: six validate, one fails (its signing
   certificate has expired; it is an older image).
2. **Registered on the live site as one batch** (records 553–559). In the
   browser, Grain read each image's C2PA manifest with Adobe's c2pa-web,
   validated it against the official C2PA trust list, and signed a summary
   into the record: signer, tool, time, validation state, the original
   manifest's label, and the SHA-256 of the exact original file.
3. **Grain's watermarked copies** -- the ones a creator publishes -- were sent
   through **WhatsApp** as photos and downloaded back. WhatsApp re-encoded every
   one as a JPEG of 9–167 KB, some at half the resolution.
4. **Every copy** went through c2patool and through Grain's live
   [verify API](../README.md#for-agents-one-http-call).

## Results

| Image | Original: OpenAI's C2PA (c2patool) | WhatsApp copy | c2patool on the copy | Grain on the copy | Original credential Grain returns |
|---|---|---|---|---|---|
| img01 | valid | 9 KB, 1086×362 | no credential | **record 553**, by fingerprint, 0 bits on chain | OpenAI OpCo, LLC · trusted |
| img02 | valid | 35 KB | no credential | **record 554**, watermark + fingerprint | OpenAI OpCo, LLC · trusted |
| img03 | valid | 47 KB, 1280×720 | no credential | **record 555**, watermark + fingerprint | OpenAI OpCo, LLC · trusted |
| img04 | valid | 119 KB | no credential | **record 556**, watermark + fingerprint | OpenAI OpCo, LLC · trusted |
| img05 | **invalid** (expired certificate) | 58 KB | no credential | **record 557**, watermark + fingerprint | OpenAI · **invalid**, reported as such |
| img06 | valid | 167 KB | no credential | **record 558**, watermark + fingerprint | OpenAI OpCo, LLC · trusted |
| img07 | valid | 37 KB, 1086×362 | no credential | **record 559**, by fingerprint, 0 bits on chain | OpenAI OpCo, LLC · trusted |

**7 of 7 copies resolved to the right record, and OpenAI's credential came
back with each one, while c2patool found no credential in any copy.** The
expired credential is reported as invalid, not vouched for. On the two most
crushed copies the watermark did not survive and the fingerprint carried the
match alone -- the reason Grain checks both.

The SHA-256 each record stored matches the original file in all seven cases
([`SHA256SUMS`](evidence/survival-2026-10-12/SHA256SUMS)): anyone holding an
original can re-validate OpenAI's signature with any C2PA tool and confirm it
is the file Grain recorded.

## What this does and doesn't show

- It shows that a credential that existed when an image was registered can
  be recovered from copies that no longer carry it, after a real platform's
  compression and resizing.
- The copies sent were Grain's watermarked versions, which already carry no
  C2PA (watermarking changes pixels, which breaks a C2PA hard binding by
  design), so this does not measure whether WhatsApp itself strips C2PA.
- Grain records the credential as validated in the creator's browser at
  registration and signed by the creator. Re-validating needs the original
  file.
- Seven images and one platform: a real-world check, not a benchmark. The
  robustness matrix in the README covers transformations at scale.
