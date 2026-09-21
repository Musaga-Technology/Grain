# Grain

**An open, onchain C2PA manifest repository with a soft-binding resolver.**
Find who made an image from the image itself — after screenshots, crops and re-encoding.

> **Status: in build.** Monad Metropolis, Track 04. Build window 1 Sep – 13 Oct 2026.
> This README is a placeholder; the one written for judges lands in Milestone 4 with
> measured numbers in it. Nothing below is a claim about working software yet.

## The gap

C2PA already solved the *format* of content provenance. A Content Credential is a signed
manifest describing where a piece of media came from — and it gets stripped by every
screenshot, re-encode and platform that doesn't support the standard.

C2PA's answer is the **durable Content Credential**: a soft binding — an invisible
watermark or a content fingerprint — that survives the copy, plus a **Soft Binding
Resolution API** for looking the manifest back up inside a **Manifest Repository**.

The spec defines the API. It does not say who runs the repository. Today that is Adobe,
Digimarc or Truepic: the lookup table deciding who made a piece of media is proprietary,
per-vendor and deletable.

**Grain is that manifest repository, onchain, permissionless, on Monad.**

## What it is not

Not an NFT. Records are looked up **by the content itself**, not by a token id; ten
thousand copies of an image resolve to one manifest; nothing is minted, traded or scarce.
There is no ERC-721 anywhere in this project, including in licensing.

## Conformance, stated honestly

Grain is **C2PA-compatible**, not C2PA-certified. We implement the Soft Binding
Resolution API shape and the soft binding assertion structure. We do not run the
`c2pa-rs` signing stack with X.509 certificates from the C2PA trust list.

## Reading order

| Document | What it is |
|---|---|
| [SPEC.md](SPEC.md) | Single source of truth for the build |
| [UX_SPEC.md](UX_SPEC.md) | The product surface, expanded from SPEC §8 |
| [docs/ROBUSTNESS.md](docs/ROBUSTNESS.md) | Milestone 0 measurements — the constants everything depends on |
| [docs/DEMO.md](docs/DEMO.md) | The demo script |
| [contracts/](contracts/) | Interface definitions, with the design decisions in the comments |
| [schemas/](schemas/) | Manifest and resolution-result schemas |

## Licence

MIT © 2026 Jerry Musaga, Musaga Technology
