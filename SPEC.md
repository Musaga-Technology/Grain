# GRAIN — Build Specification

> Open provenance registry for content that gets copied.
> Monad Metropolis hackathon, Track 04 (Trust, Identity & AI Infrastructure).
> Submission deadline: **13 Oct 2026**. Spec written 20 Sep 2026.

This document is the single source of truth for the build. Read it fully before writing code.
If something here conflicts with an assumption you'd otherwise make, this document wins.
If something here is wrong or unbuildable, say so before building around it.

---

## 0. Ground rules

**Non-negotiables**

1. **No crypto vocabulary on the primary user path.** No "connect wallet", no gas, no chain IDs, no
   "sign transaction", no network switching. A photographer who has never used crypto must be able
   to register and verify without asking a question. This is a judged product, and the judges are
   investors who have seen a thousand wallet-connect modals.
2. **Every commit lands inside the build window** (1 Sep – 13 Oct 2026). Judges verify what was
   built during the six weeks. Fresh repo, dated commits, no history imported from elsewhere.
3. **The repo must be public** and readable by `metropolis@hackathon.monad.xyz` per hackathon rules.
4. **Nothing is mocked in the demo path.** If a feature can't run live, it doesn't go in the demo.
   Simulated data is the single fastest way to lose this track.
5. **Ship the image product completely before touching any stretch goal.** See §13.

**What we're being judged on:** a working product, a demo, a short write-up, and a link to the code.
Track 04 pays $30,000 split evenly between 3 teams. There is also a $25,000 grand champion prize
across all four tracks.

---

## 1. What Grain is

C2PA (Coalition for Content Provenance and Authenticity) already solved the *format* of content
provenance. A Content Credential is a signed manifest describing where a piece of media came from.

The problem: manifests get stripped. Every screenshot, every re-encode, every platform that doesn't
support the standard destroys them. C2PA's answer is **durable Content Credentials** — a hard
binding (a byte-exact hash) plus a **soft binding** (an invisible watermark or a content
fingerprint) that lets the manifest be rediscovered even when the bits have changed. Recovery needs
two things: a soft binding algorithm list, and a **Soft Binding Resolution API** that looks the
manifest up inside a **Manifest Repository**.

**That Manifest Repository is the hole Grain fills.** The spec defines the API to query it, but the
repository itself is just a database, and today it belongs to Digimarc, Adobe or Truepic. The
lookup table that decides who made a piece of media is proprietary, per-vendor, and deletable.

**Grain is that manifest repository, onchain, permissionless, with a spec-conformant resolution API
in front of it.**

### What Grain is not

Expect the question "is this NFTs?" from a judge. It is not, and the distinction is the product:

| NFT | Grain |
|---|---|
| Looked up by token ID | Looked up **by the content itself** |
| Ownership, transferable | A signed claim about origin, not a property right |
| One token per thing | Ten thousand copies resolve to one manifest |
| Minted, traded, scarce | Nothing minted, nothing traded, no scarcity |

One-liner: *NFTs answer "who owns this token." Grain answers "where did this pixel come from."*

**Do not add an ERC-721 anywhere in this project**, including to the licensing flow. It would be
easy and it would drag the pitch into a category the judges are tired of.

### Why it has to be on a chain, and why Monad

Have all three of these ready in the write-up:

1. **Nobody can unpublish your provenance.** A vendor repository can drop your manifest, get
   acquired, or shut down. A chain record can't be retracted by a third party.
2. **The transparency log is free.** Registrations are ordered and timestamped by consensus, so
   "this manifest existed before that deepfake circulated" is provable without trusting a log
   operator. Priority disputes resolve by block order.
3. **The workload is per-asset writes and similarity reads.** Every generation, every edit, every
   republish is a row, and resolution is a nearest-neighbour search over the whole corpus. A
   watermark lookup is a hashmap that works anywhere; **similarity search over millions of
   fingerprints is what needs cheap storage and 400ms blocks.** That is the Monad-specific claim
   and it should be front and centre.

### Making that argument provable — the seeded corpus

**This is the weakest joint in the pitch, and it is cheap to fix.** Points 1 and 2 above
are true of any cheap chain, not of Monad specifically. Point 3 is the real claim, and a
judge will reasonably ask whether it's a claim or a demonstration.

So demonstrate it. **Before the demo, seed the registry with 50,000–100,000 real
fingerprints** — hash a public image corpus (Unsplash Lite, Open Images, Wikimedia
Commons; check the licence and credit it) and batch-register them on testnet.

What this buys, in order of value:

1. **The demo stops being "five images and a button."** It becomes a live similarity
   search across a hundred thousand records, executing on chain, resolving inside one
   block. That is a thing you cannot do elsewhere without it being a stunt.
2. **Real bucket sizes.** §6.3's scaling discussion turns from a caveat into measured
   data you can put in a table.
3. **The LSH recall test becomes meaningful at realistic scale** instead of at 1,000
   records.
4. **A comparison table with numbers in it.** Registration cost and resolution latency
   on Monad against what the same workload would cost on Ethereum mainnet. Measured,
   not asserted.

Seeding moves Monad from *hosting* Grain to *enabling* it. Without it, the honest answer
to "why Monad rather than any cheap L2" is "mostly vibes", and these judges will find that.

**Related framing fix:** Mera is not a bounty checkbox. It is the Monad-native identity
layer the entire onboarding is built on, and it is not portable to another chain. Put it
in the architecture section of the README, not in the integrations list at the bottom.

---

## 2. Critical design decision: two co-equal resolution paths

**The watermark alone cannot carry this product.** TrustMark is sensitive to JPEG compression,
resizing, colour-space conversion and format conversion. Independent evaluation found it degrades
noticeably under resizing (903 recovered out of 1097) and weakens gradually under blur rather than
failing outright. Raising `WM_STRENGTH` to 1.5 improves robustness enough to survive printing, but
introduces visible ripple artifacts — unacceptable for a product whose pitch is invisibility.

Therefore:

- **Path A — watermark.** Decode a TrustMark payload carrying a `recordId`. Direct lookup. Fast,
  exact, but brittle under heavy transformation.
- **Path B — fingerprint.** Compute a perceptual hash and do a similarity search. Survives much
  more, but returns candidates rather than a certainty.

**Both run in parallel on every verify.** Neither is a fallback. This is also what C2PA guidance
prescribes: a fingerprint stored in the manifest serves both as a fallback search key *and* as the
anti-spoof cross-check.

### The anti-spoof check (do not skip this)

Watermarks can be **transferred**: lift the watermark from a registered image, paste it onto a
different image, and a naive resolver will attribute your image to someone else. The mitigation is
in the C2PA guidance: store a fingerprint inside the manifest, and at lookup time compare it against
a fingerprint computed from the watermark-bearing asset. If they don't match, the asset was
modified or isn't the original.

This produces a third resolution state (`TAMPERED`) and it is the best thirty seconds of the demo.

---

## 3. Architecture

```
                    ┌──────────────────────────────────────┐
   creator ───────▶ │  apps/web  (Next.js, App Router)     │
   (passkey)        │  /          verify  (no auth)        │
                    │  /register  register (passkey only)  │
                    └───────┬──────────────────────┬───────┘
                            │                      │
                  packages/grain-core              │ viem
            (fingerprint, watermark, manifest)     │
                            │                      ▼
                            │            ┌────────────────────┐
                            │            │ Monad testnet      │
                            │            │ 10143              │
                            │            │  GrainRegistry     │
                            │            │  FingerprintIndex  │
                            │            │  CreatorRegistry   │
                            │            │  LicenseRegistry   │
                            │            └─────────┬──────────┘
                            │                      │ events
                            ▼                      ▼
                    ┌───────────────┐      ┌────────────────┐
                    │ packages/     │◀─────│ packages/      │
                    │ resolver      │      │ indexer (Envio │
                    │ (C2PA SBR API)│      │  HyperIndex)   │
                    └───────┬───────┘      └────────────────┘
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
      plugins/mm-grain   CRE Sentinel   any C2PA client
      (MetaMask          (Chainlink)    (spec-conformant)
       Agent Wallet)
```

**Source of truth is always the chain.** The Envio index is a read accelerator. Every surface that
shows a resolution result must be able to prove it against the chain on demand.

---

## 4. Monorepo layout

pnpm workspaces + Turborepo. Node 22.18+ (required by the MetaMask CLI later; keep one version
across the repo).

```
grain/
├── apps/
│   └── web/                     Next.js 15, App Router, TypeScript, Tailwind
├── packages/
│   ├── contracts/               Foundry
│   ├── grain-core/              fingerprint + watermark + manifest (isomorphic TS)
│   ├── resolver/                Hono API implementing C2PA SBR
│   ├── indexer/                 Envio HyperIndex
│   └── cre-sentinel/            Chainlink CRE workflow
├── plugins/
│   └── mm-grain/                MetaMask Agent Wallet plugin (published to npm)
├── docs/
│   ├── ROBUSTNESS.md            output of Milestone 0, updated as it changes
│   └── DEMO.md                  the demo script, rehearsed
├── SPEC.md                      this file
├── README.md                    written last, written for judges
└── turbo.json
```

`grain-core` must be isomorphic — the browser uses it for registration and verification, the
resolver and the plugin use it server-side. Do not fork the fingerprint implementation; a
fingerprint computed in the browser and one computed in Node **must be bit-identical**, and there
must be a test asserting that.

---

## 5. packages/grain-core

The heart of the system. Build and test this before the contracts.

### 5.1 Fingerprint

64-bit DCT-based perceptual hash (pHash).

```ts
export function fingerprint(image: ImageInput): bigint   // uint64
export function hammingDistance(a: bigint, b: bigint): number
```

Pipeline, specified exactly so browser and Node agree:

1. Decode to RGBA.
2. Convert to greyscale using ITU-R BT.601 luma: `0.299R + 0.587G + 0.114B`, rounded half-up.
3. Resize to 32×32 using a **box filter** (not bilinear, not Lanczos — resampler differences are
   the number one cause of cross-platform hash drift). Implement the resize inside `grain-core`
   rather than delegating to the platform, so both environments run identical code.
4. 2D DCT-II over the 32×32 matrix.
5. Take the top-left 8×8 block, discard the DC term at `[0][0]`.
6. Median of the remaining 63 coefficients; each coefficient becomes a bit (1 if above median).
   Pad to 64 bits with a trailing 0.

**Determinism test (required):** a fixture set of 20 images, hashed in Vitest under Node and under
a headless browser, asserting identical output. If this test doesn't exist, the whole fingerprint
path is untrustworthy.

Thresholds, to be confirmed in Milestone 0 and then treated as constants:

- `MATCH_THRESHOLD = 7` — Hamming distance at or below this is a match.
- `TAMPER_THRESHOLD = 12` — watermark resolves but fingerprint distance exceeds this → `TAMPERED`.
- Between the two: `UNCERTAIN`, surfaced as a match with a caveat (see §8.3).

### 5.2 Watermark

Adobe TrustMark, via the JavaScript/ONNX implementation in the browser and Python or the Rust CLI
server-side. TrustMark encodes, decodes and removes watermarks at arbitrary resolution, and is on
the C2PA approved soft binding list as `com.adobe.trustmark.Q` (identifier `4`).

```ts
export async function embed(image: ImageInput, recordId: bigint): Promise<Uint8Array>
export async function decode(image: ImageInput): Promise<bigint | null>
```

**Payload capacity is the constraint that shapes the registry.** TrustMark's payload is small — the
documentation notes that even 40 bits gives a key space of around a trillion. It cannot carry a
32-byte manifest hash. So:

- The watermark carries a **sequential `uint64` recordId**, nothing else.
- Milestone 0 must confirm the exact usable bit width for the chosen variant and encoding, and
  `MAX_RECORD_ID` is set from that measurement. Write the number into `docs/ROBUSTNESS.md`.

Use **variant Q** (the default, PSNR 43–45 dB, balanced robustness and imperceptibility). Variant P
is higher quality but we need the robustness. Tune `WM_STRENGTH` up from 1.0 only as far as the
highest value that produces no visible ripple on the demo images — determine this by eye in
Milestone 0 and pin it as a constant.

Aspect-ratio caveat to handle: TrustMark generates residuals at 256×256 and scales them into the
image, and auto-centre-crops when the aspect ratio exceeds 2:1, which degrades the watermark on
very long or thin images. Detect ratio > 2.0 at registration, warn the user in plain language, and
lean on the fingerprint path for those.

### 5.3 Manifest

C2PA-compatible manifest, CBOR-encoded.

```ts
export interface GrainManifest {
  version: 1
  recordId: bigint
  creator: `0x${string}`          // the Mera-derived signing address
  createdAt: number               // unix seconds, client-asserted
  assertions: {
    softBindings: Array<{
      alg: 'com.adobe.trustmark.Q' | 'grain.phash.v1'
      algId: number               // 4 for TrustMark Q; 0 for ours pending registration
      value: string               // hex
    }>
    title?: string
    generator?: string            // e.g. "Grain Web 0.1.0" or an AI model name
    license?: { priceWei: bigint; terms: string }
  }
  private?: string                // AES-GCM ciphertext, see §9.3
}
```

The manifest **always** contains the fingerprint as a soft binding assertion, even when a watermark
is present. That is what makes the anti-spoof check possible.

Sign with the Mera-derived key over `keccak256(cbor(manifest without signature))`, EIP-191 personal
sign. Store the signature alongside.

**Honest labelling rule:** we are C2PA-*compatible* in structure and we implement the Soft Binding
Resolution API shape. We are not running the full `c2pa-rs` signing stack with X.509 certificates
from the C2PA trust list. Say exactly that in the README. Overclaiming conformance in front of
judges who may know the spec is a much bigger risk than the gap itself.

---

## 6. packages/contracts

Foundry. Solidity 0.8.26. Deploy to **Monad testnet, chain ID 10143**. Mainnet is `143` — used only
by the MetaMask plugin if you go live, see §12.

### 6.1 Storage strategy

Manifests go in **event data, not contract storage.** Storage holds only a `manifestHash`.

Rationale, which you should also put in the README because it will be questioned: event data is
permanent chain history, readable by any node or indexer forever. Contract storage would only add
*contract-readable* access, which nothing in this system needs. Events cost a fraction of storage,
and that is what makes a per-asset registration economically sane. The "nobody can unpublish you"
claim holds either way — the data is in the chain's history.

### 6.2 GrainRegistry.sol

```solidity
struct Record {
    address creator;
    uint64  fingerprint;      // uint64 pHash
    bytes32 manifestHash;     // keccak256 of the CBOR manifest
    uint40  registeredAt;     // block.timestamp
    uint64  supersededBy;     // 0 if current
    bool    revoked;
}

mapping(uint64 recordId => Record) public records;
uint64 public nextRecordId;   // starts at 1; 0 is the null id

event ManifestRegistered(
    uint64 indexed recordId,
    address indexed creator,
    uint64 fingerprint,
    bytes32 manifestHash,
    bytes manifest            // full CBOR, event-only
);
event ManifestSuperseded(uint64 indexed oldId, uint64 indexed newId);
event ManifestRevoked(uint64 indexed recordId);

function register(uint64 fingerprint, bytes calldata manifest) external returns (uint64 recordId);
function supersede(uint64 oldId, uint64 fingerprint, bytes calldata manifest) external returns (uint64);
function revoke(uint64 recordId) external;
```

- `register` computes `manifestHash = keccak256(manifest)`, assigns the next id, writes the
  `Record`, calls `FingerprintIndex.insert(recordId, fingerprint)`, emits the event.
- `msg.sender` is the creator. No signature recovery needed on chain — the manifest carries its own
  signature for offchain verification, and the transaction sender is already authenticated.
- `supersede` and `revoke` require `msg.sender == records[id].creator`.
- Cap `manifest.length` at **16 KB** and revert above it with a clear custom error.
- **Do not deduplicate by fingerprint.** Two different creators may legitimately register visually
  similar images, and adjudicating that on chain is out of scope. Resolution returns all candidates
  ordered by block, and the UI shows the earliest. Say this out loud in the write-up — it's a
  deliberate design position, not an oversight.

### 6.3 FingerprintIndex.sol

The technically interesting contract. Locality-sensitive hashing for approximate nearest-neighbour
search on chain.

```solidity
uint8 constant BANDS = 8;          // 8 bands × 8 bits = 64-bit fingerprint
mapping(uint8 band => mapping(uint8 value => uint64[] recordIds)) private buckets;

function insert(uint64 recordId, uint64 fingerprint) external onlyRegistry;
function queryBand(uint8 band, uint8 value, uint256 offset, uint256 limit)
    external view returns (uint64[] memory);
function bandSize(uint8 band, uint8 value) external view returns (uint256);
function verify(uint64 recordId, uint64 queryFingerprint) external view returns (uint8 distance);
```

**Why 8 bands of 8 bits.** Pigeonhole: if two fingerprints differ in at most 7 bits, at least one of
the 8 bands is identical, so the candidate set is guaranteed to contain every true match at Hamming
distance ≤ 7. That matches `MATCH_THRESHOLD`. Four bands of 16 bits would only guarantee recall to
distance 3 — too tight for real-world re-encoding.

**Known scaling limit, and be upfront about it.** Eight-bit bands give 256 buckets per band, so at
a million records a bucket averages ~3,900 ids and reading one on chain gets expensive. This is
fine at hackathon scale and it is the right shape to demonstrate. **Measure the real
distribution against the seeded corpus (§1) rather than reasoning about the average** —
the tail bucket is what matters and it will not be 3,900. In the README, state the
production path honestly: wider bands with more of them (multi-index hashing), and offchain fan-out
with onchain verification. Which is exactly what §7 already does.

Recommended division of labour in the live system: **Envio fans out the candidates, the chain
verifies the winner.** `verify()` exists so any result can be proven on chain in one call, and the
UI exposes that as a button.

### 6.4 CreatorRegistry.sol

```solidity
struct Creator {
    string  handle;        // unique, lowercase, [a-z0-9-], 3-30 chars
    string  profileURI;    // optional
    uint256 licensePriceWei;  // 0 = not for licence
}
mapping(address => Creator) public creators;
mapping(bytes32 handleHash => address) public handleOwner;

function setProfile(string calldata handle, string calldata profileURI, uint256 licensePriceWei) external;
```

Kept deliberately separate from content records. The C2PA specification does not address human or
organisational identity — it focuses on the provenance of the content itself, for privacy reasons.
Mirroring that separation in the contract layout is a small thing that reads as competence to
anyone who knows the spec. Note it in a code comment and in the write-up.

### 6.5 LicenseRegistry.sol

Used by the MetaMask plugin (§12).

```solidity
event LicenseGranted(
    uint64 indexed recordId,
    address indexed licensee,
    address indexed creator,
    uint256 amountWei,
    uint40 grantedAt
);

function license(uint64 recordId) external payable;
```

Pulls the price from `CreatorRegistry`, requires `msg.value >= price`, forwards the full amount to
the creator with a `call`, emits the event. Refund any excess. No protocol fee — a fee invites
tokenomics questions that lead nowhere good in judging.

### 6.6 Tests

Foundry, and these specifically:

- Round-trip: register → read back → manifest hash matches.
- LSH recall: generate 1,000 random fingerprints, flip ≤7 bits on each, assert **every** perturbed
  query returns the original in its candidate set. This is the correctness proof for §6.3 and it
  should be in the README as a claim.
- Gas: a `forge snapshot` for `register` at 1 KB, 4 KB and 16 KB manifests. Put the numbers in the
  README — the whole Monad argument rests on them, so having them measured rather than asserted is
  worth real points.
- Access control on `supersede`, `revoke`, `setProfile`, `insert`.
- License: exact payment, overpayment refund, underpayment revert, unpriced record revert.

---

## 7. packages/resolver

Hono, deployed anywhere with an HTTPS endpoint. Implements the **C2PA Soft Binding Resolution API**
shape so that existing C2PA clients can point at Grain without modification. This is the strongest
single line in the write-up: we are conformant to a published spec rather than inventing an
endpoint.

```
GET  /v1/manifests?alg=<algId>&value=<hex>     → resolve by soft binding
POST /v1/resolve      multipart image          → full pipeline, both paths
GET  /v1/records/:id                           → single record + manifest
GET  /health
```

`POST /v1/resolve` is the one the web app and the plugin use:

1. Decode the watermark. If found → load record by id.
2. Compute the fingerprint. Query Envio for candidate ids (fall back to direct `queryBand` calls
   against the chain if the indexer is unreachable — **the product must work with the indexer
   down**, and demoing that fallback live is a nice flex).
3. Rank candidates by Hamming distance, filter by `MATCH_THRESHOLD`, order ties by `registeredAt`.
4. Run the anti-spoof cross-check (§2) if the watermark resolved.
5. Return a resolution result.

```ts
type Resolution =
  | { state: 'RESOLVED';  record: Record; manifest: GrainManifest;
      via: 'watermark' | 'fingerprint' | 'both'; distance: number }
  | { state: 'UNCERTAIN'; candidates: Record[]; distance: number }
  | { state: 'TAMPERED';  claimed: Record; distance: number }
  | { state: 'NOT_FOUND' }
```

No auth, no rate limit key, CORS open. It's a public good; treat it like one.

---

## 8. apps/web — the UX specification

**This section is as important as the contracts.** The entire pitch collapses if verification feels
like using a blockchain app.

### 8.1 Routes

| Route | Purpose | Auth |
|---|---|---|
| `/` | Verify | none |
| `/register` | Register an image | passkey |
| `/r/[recordId]` | Permanent record page, shareable | none |
| `/c/[handle]` | Creator profile and their registrations | none |
| `/dashboard` | The signed-in creator's records | passkey |
| `/sentinel` | Where my work is appearing (§11) | passkey |

### 8.2 `/` — Verify, the front door

The first screen must communicate the whole product in three seconds with no explanation.

**Input.** Three ways in, all equally primary:
- Drag and drop anywhere on the page (the entire viewport is the drop zone, not a bordered box).
- **Clipboard paste (`Cmd/Ctrl+V`), handled at the document level.** People screenshot things and
  paste. This is the single most important input path and it is the one most apps forget.
- A plain file picker for people who want a button.

The page should say what to do in one line — "Drop an image, or paste one" — and nothing else above
the fold. No hero copy, no feature grid, no "powered by" logos.

**Processing.** Target under two seconds to a result. Show one progress line, not a spinner:
"Reading the image → Checking the watermark → Searching by content". If it runs past four seconds,
show what's still outstanding rather than a generic wait.

**Output — one answer, large.**

```
        Made by  Ana Ruiz
        registered 12 days ago
        ────────────────────
        matched by watermark and content
        verify on chain ↗
```

- Creator name is the headline, linked to `/c/[handle]`.
- Relative time is the subhead. The block number is a **small timestamp link underneath**, not a
  labelled field.
- **No confidence percentages anywhere.** "87% match" invites an argument you cannot win in a live
  demo. Say matched, or don't.
- "verify on chain" calls `FingerprintIndex.verify()` directly from the browser and shows the
  distance returned by the contract. This is how you prove the indexer isn't lying, and it's a good
  answer to a sceptical judge.

### 8.3 The four states, visually distinct

Each needs its own treatment. A user should know which one they're looking at from across a room.

| State | Treatment | Headline | Body |
|---|---|---|---|
| `RESOLVED` | calm, confident, neutral surface | "Made by {name}" | how it matched, when registered |
| `UNCERTAIN` | same as resolved, with a caveat line | "Probably made by {name}" | "This copy has been heavily edited. The match is close but not exact." |
| `TAMPERED` | **alarming — this is the demo moment** | "This image is claiming someone else's credentials" | "It carries {name}'s watermark, but the picture doesn't match what {name} registered. Someone copied the mark onto a different image." |
| `NOT_FOUND` | quiet, not an error | "No record for this image" | "It may never have been registered, or it's been edited past recognition." Then a single link: "Register an image →" |

`NOT_FOUND` must not look like a failure. Most images on earth are not registered; that's the
starting condition, not a bug.

### 8.4 `/register`

The entire flow is: choose image → one biometric prompt → done.

1. Drop or pick an image. Show a preview immediately.
2. Optional title field. Nothing else. No tags, no categories, no description.
3. One button: **"Register with Face ID"** (adapt the label to the platform).
4. The passkey prompt appears. That is the only authentication step. No seed phrase, no wallet
   connection, no network prompt.
5. Watermark is embedded in-browser, fingerprint computed, manifest built and signed, transaction
   sent.
6. **The watermarked file downloads automatically** with a `-grain` suffix, plus a clear line:
   "Use this copy from now on — it's the one that carries the mark." Getting this wrong means users
   publish the un-watermarked original and the product silently doesn't work.
7. Result screen: the record page at `/r/[id]`, with a copy-link button.

**Error copy in plain language, no error codes on screen.** The one to handle carefully is the
desktop Chrome PRF failure (§9.2):

> "Your browser saved this passkey somewhere Grain can't use. Save it to Google Password Manager
> instead, or use Safari, iOS, or 1Password."

### 8.5 Design direction

Restrained and editorial, closer to a photography publication than a crypto dapp. Reference points:
Content Authenticity Initiative's own tooling, Are.na, Readymag. Concretely:

- One accent colour used almost nowhere, so that when `TAMPERED` uses it, it lands.
- Real typographic hierarchy, generous whitespace, images shown large.
- Dark mode via `prefers-color-scheme`, tokens on `:root`, no toggle.
- No gradients, no glassmorphism, no animated backgrounds, no 3D.
- Mobile-first. Judges will open this on a phone at least once.

---

## 9. Mera — passkey identity

Targets two Monad Foundation bounties, $2,500 each: "Best Mera-Powered UX" and "Mera: One Passkey,
Many Keys". One integration, designed to satisfy both.

### 9.1 How Mera works

`@category-labs/mera` derives EVM accounts from a passkey. The same passkey reproduces the same
accounts on every sign-in, the accounts are regular EOAs, there is nothing to deploy, and no bundler
or MPC service to run. After you have an address, it's ordinary viem against a Monad RPC.

```ts
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput } from '@category-labs/mera'

// first visit
const { credentialId, prfSalt, prfOutput } = await createPasskeyWithPrfOutput({
  rp: { id: location.hostname, name: 'Grain' },
  user: { name: email, displayName: name },
})
// returning visit
const { prfOutput } = await getPasskeyPrfOutput({ rpId, credential: { credentialId, transports } })
```

Store `credentialId` and `transports` in `localStorage` — that metadata holds no key material.
Derive a BIP-39 seed from `prfOutput`, then HD-derive by index. Hold the seed in memory for the
session only and end the signing session explicitly.

Install: `npm install @category-labs/mera viem @scure/bip32 @scure/bip39`.

### 9.2 The trap — handle it on day one

On desktop Chrome, **only passkeys saved to Google Password Manager return PRF**. When Chrome saves
to the local profile instead, the passkey is created but Mera throws `PRF_UNAVAILABLE`. This is the
most common setup failure and it will happen on the demo machine if you don't check.

- Test the demo browser and device combination in Milestone 0, not in week three.
- Catch `PRF_UNAVAILABLE` explicitly and show the copy in §8.4.
- Recommended demo environment: Safari on macOS with iCloud Keychain, or 1Password.

### 9.3 One passkey, many keys

Three PRF namespaces from one passkey, using distinct `prfSalt` values. Mera's default salt is
`sha256("mera.prf.salt.v1")`, and passing an explicit salt is the supported way to create custom
namespaces.

| Namespace | Salt | Purpose |
|---|---|---|
| `grain.identity.v1` | `sha256("grain.identity.v1")` | Creator signing key, HD index 0. Signs every manifest. |
| `grain.channel.v1` | `sha256("grain.channel.v1")` | Per-channel publishing keys at HD index *n*. One per outlet — personal, agency, a specific client. Registrations are unlinkable across channels but all recoverable from the one passkey. |
| `grain.vault.v1` | `sha256("grain.vault.v1")` | HKDF → AES-256-GCM key encrypting private manifest fields. |

**The vault namespace is the genuinely novel part and it should be demoed.** C2PA identity
assertions carry real privacy risk — the spec itself flags that users should be aware of the
implications of including identity information. Grain's answer: private fields (capture location,
device, client name) are encrypted client-side, only the ciphertext goes in the manifest, and the
key is re-derivable from the passkey on any device. Selective disclosure — reveal to a licensing
buyer, not to the world.

Derivation is not encryption: HKDF for key derivation, AES-GCM for data, a distinct salt per
namespace, PRF output and derived keys zeroed after use, nothing persisted.

**The recovery demo, 20 seconds, do it live:** clear site data in the browser, sign in on a phone
with the synced passkey, and every record, channel key and encrypted field is back. Nothing was
stored anywhere.

---

## 10. packages/indexer — Envio

Targets "Best Use of Envio", $1,000. Envio's founder is both a mentor and a judge on this
hackathon, so make the integration load-bearing and go talk to him during the build window.

HyperIndex over `GrainRegistry` and `LicenseRegistry` events. Entities:

- `Record` — decoded from `ManifestRegistered`, with the full manifest decoded from the event data,
  plus `supersededBy` and `revoked` kept current.
- `Creator` — aggregated from `CreatorRegistry`, with a record count.
- `FingerprintBand` — the 8 band values per record, which is what makes the candidate fan-out a
  single GraphQL query instead of 8 chain reads.
- `License` — from `LicenseGranted`.

The fan-out query the resolver uses:

```graphql
query Candidates($bands: [BandInput!]!) {
  records(where: { bands: { _overlaps: $bands }, revoked: { _eq: false } }) {
    recordId fingerprint creator registeredAt manifest
  }
}
```

Hosted on Envio Cloud. The resolver must degrade to direct chain reads when it's unavailable —
see §7.

---

## 11. packages/cre-sentinel — Chainlink CRE

Targets "Best workflow with CRE", $3,000. Build this as a real workflow, not an API call bolted on
for a logo — judges can tell.

**Sentinel: where is my work appearing?**

A scheduled CRE workflow that:

1. Reads a watchlist (URLs, or a feed) from the registry, published by creators.
2. Fetches each image.
3. Runs it through the resolver.
4. When a registered asset is found in the wild **stripped of its credentials**, writes an onchain
   attestation: `recordId`, where it was seen, when, and whether a licence exists for that
   `(recordId, licensee)` pair.

This is a genuine multi-step offchain workflow terminating in an onchain write, which is what CRE
is for. It also closes the product loop: creators get a feed at `/sentinel` showing where their work
appears and whether it was paid for.

Keep the watchlist small and real for the demo. Three URLs that actually contain your registered
demo images beats a hundred fake ones.

---

## 12. plugins/mm-grain — MetaMask Agent Wallet plugin

Targets "Best Agent Wallet Plugin", $2,500. **Both gating conditions are confirmed clear:**

- No Early Access Program. Prerequisites are Node.js 22.18+ and an agent that supports skills
  (Claude Code, Codex, Cursor, OpenClaw, Hermes). Install: `npm install -g @metamask/agent-wallet@latest`.
- **Monad is preconfigured**: mainnet `143` marked *Covered* for Transaction Shield (so threat
  scanning actually applies, unlike chains marked No), and Monad Testnet `10143` on the testnet
  list. Confirm against `mm chains list --json` for your CLI version before scripting.

### 12.1 Plugins are not skills

Skills teach an agent which `mm` commands to run. **Plugins add new commands to `mm` itself.** Start
from the official template `MetaMask/agent-wallet-plugin-template`, which ships a working
`mm hello ping` you rename and extend. Extend `PluginCommand` from `@metamask/agent-wallet/plugin`
and implement `execute` — the rest of the lifecycle is sealed by the host. There's also a plugin
examples repo including an ENS resolver built on the authenticated RPC client.

### 12.2 Commands

| Command | Auth | Capabilities | Does |
|---|---|---|---|
| `mm grain verify <file>` | `requiresAuth = false` | none | Resolves an image against Grain. Works before sign-in — good demo beat. |
| `mm grain license <file>` | yes | `wallet-read`, signing | Resolves, reads creator and price, pays on Monad via `LicenseRegistry`, returns the licence record. |
| `mm grain register <file>` | yes | signing | For agents publishing their own output — provenance from birth. |

Manifest, per the template's `mm` block. Keep the plugin-wide `capabilities` array empty, because
it merges into every command — declare per-command instead. Users consent to these at install time.

```json
"mm": {
  "schemaVersion": 1,
  "minCliVersion": "^6.2.0",
  "capabilities": [],
  "commands": [
    { "id": "grain:verify",   "capabilities": [],              "dataAccess": [] },
    { "id": "grain:license",  "capabilities": ["wallet-read"], "dataAccess": ["balances"] },
    { "id": "grain:register", "capabilities": ["wallet-read"], "dataAccess": ["balances"] }
  ]
}
```

File path defines the command: `src/commands/grain/verify.ts` → `mm grain verify`, id
`grain:verify`. Declare inputs once as a schema and let `schemaToFlags` / `schemaToArgs` generate
the surface; `--json`, `--format`, `--toon` and `--verbose` are inherited automatically.

Local testing:

```bash
npm run build
mm config set experimentalPlugins true
mm config set experimentalAllowUnverifiedInstalls true
mm plugins install "file:$PWD" --accept-permissions
mm grain verify ./fixtures/screenshot.png
```

Publish to npm as `mm-grain` so it installs with `mm plugins install mm-grain`. The plugin system
is still experimental — document the two config flags in the plugin README, because judges who try
it will hit them otherwise.

### 12.3 Why the wallet is in the picture at all

Strip the payment out and this is a lookup tool that needs no wallet. The payment is the point:
the agent pays a stranger, so it needs custody with limits. Every transaction runs simulation, then
Blockaid threat scanning, then policy evaluation; in Guard Mode the agent stays inside allowlists
and outflow limits, and anything outside policy sits in `AWAITING_MFA` until the human approves by
push or email.

The sentence for judges: *my agent licenses images autonomously on a weekly budget, paying creators
directly, and it physically cannot spend past the limit or touch my main wallet.*

There's an existing x402 guide for paying paywalled APIs, so this pattern is supported rather than
invented.

---

## 13. Build order and dates

23 days. The order matters more than the schedule — **never start a later milestone before the
earlier one is done.**

### Milestone 0 — De-risk (20–22 Sep)

Before writing any product code. Output is `docs/ROBUSTNESS.md`.

- [ ] TrustMark JS/ONNX running in-browser. Measure the usable payload bit width.
- [ ] Robustness matrix on 20 real images: screenshot, JPEG Q40, JPEG Q20, 50% downscale, 10% crop,
      25% crop, Instagram-style filter, one real platform round-trip. Record watermark recovery rate
      and fingerprint Hamming distance for each.
- [ ] Pin `WM_STRENGTH` at the highest value with no visible ripple.
- [ ] Confirm `MATCH_THRESHOLD` and `TAMPER_THRESHOLD` against the measured distances.
- [ ] Mera PRF working on the actual demo browser and device.

**If the watermark recovery rate is under ~50% on screenshots, that's fine** — it changes the demo
narration, not the architecture, because the fingerprint path is co-equal by design. Update
`docs/DEMO.md` accordingly and carry on.

### Milestone 1 — Core (23–28 Sep)

- [ ] `grain-core` complete with the browser/Node determinism test passing.
- [ ] All four contracts, full test suite, gas snapshot, deployed to Monad testnet 10143.
- [ ] LSH recall test passing at 1,000 records.
- [ ] A CLI script that registers and resolves end-to-end, no UI.
- [ ] **Corpus seeded: 50,000–100,000 fingerprints batch-registered on testnet** (§1).
      Script it as `pnpm seed` so it can be re-run against a fresh deployment.
      Record bucket-size distribution, registration gas, and resolution latency at
      that scale — those three numbers carry the Monad argument in the README.

### Milestone 2 — Product (29 Sep – 4 Oct)

- [ ] Resolver implementing the SBR shape, with the chain-read fallback.
- [ ] Envio indexer deployed.
- [ ] Mera with all three namespaces, including recovery.
- [ ] `/`, `/register`, `/r/[id]` complete, all four states, real copy.

**This is a shippable product. If everything after this point were cut, you would still have a
strong Track 04 submission.**

### Milestone 3 — Bounties (5–9 Oct)

- [ ] CRE Sentinel workflow and `/sentinel`.
- [ ] `mm-grain` plugin, three commands, published to npm.
- [ ] `/c/[handle]`, `/dashboard`.
- [ ] LLM provenance summaries (§14).

### Milestone 4 — Submission (10–13 Oct)

- [ ] Demo video. Rehearse it at least five times; the live abuse sequence must be muscle memory.
- [ ] README for judges: the standards gap, the three-part why-Monad argument, the measured gas
      numbers, the honest conformance note, the robustness matrix.
- [ ] Deploy everything to stable URLs. Nothing behind localhost.
- [ ] Submit at least 24 hours before the deadline.

**Video is not on this schedule.** TrustMark is image-only, so video means per-keyframe
fingerprinting plus audio fingerprinting plus a new index shape. It is a separate project. If
Milestone 3 finishes early, polish the demo instead.

---

## 14. LLM provenance summaries

Targets Kimi ($3,000 in credits) and Qwen ($5,000 in credits). Half a day, two bounties.

One feature: given a record and its supersession chain, produce a plain-language history — "Shot on
a Sony A7 in March. Edited twice. Cropped. Re-encoded three times. First registered 12 days ago."

Kimi primary, Qwen as fallback on error. Keys optional — **if no key is set, the button shows a
friendly message and the rest of the app works untouched.** Never let a missing optional key break
the demo.

Alchemy ($1,000 in credits): just use an Alchemy RPC endpoint. Free points.

---

## 15. Demo script

Rehearse until it's mechanical. Target 3 minutes.

**Act 1 — Register (30s).** Drop a photo. One Face ID prompt. Registered, block shown. The
watermarked file downloads. No wallet UI appeared at any point — say that out loud.

**Act 2 — Abuse it (90s).** Take the registered image and destroy it live, on camera:
screenshot it, crop it, crush it to JPEG Q40, run a filter over it, push it through a real platform.
Drop each mangled copy into Verify. Each one resolves. Show which path won each time — the honest
mix of watermark and fingerprint is more convincing than a claimed 100%.

**Act 3 — The attack (30s).** Lift the watermark from the registered image, paste it onto a
completely different picture, drop it in. `TAMPERED`. "It's carrying Ana's mark, but it isn't Ana's
picture." Then hit "verify on chain" so the contract itself confirms the distance.

**Coda (30s).** Terminal: `mm grain license ./found-image.jpg`. The agent resolves it, finds the
creator, pays them on Monad in under a second, and the licence lands in the registry. Then a
photographer's `/sentinel` page showing where their work appeared and whether it was paid for.

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| TrustMark weaker than hoped in-browser | Fingerprint path is co-equal by design. Milestone 0 measures it; the demo narration adapts. |
| Browser/Node fingerprint drift | Determinism test in Milestone 1. Own the resize step rather than delegating it. |
| `PRF_UNAVAILABLE` on the demo machine | Tested in Milestone 0. Demo on Safari/iCloud Keychain or 1Password. |
| Envio down mid-demo | Resolver falls back to direct chain reads. Demo the fallback deliberately. |
| Judge asks "why not just a database?" | The three-part answer in §1, with measured gas numbers. |
| Judge asks "is this NFTs?" | §1. Do not add an ERC-721. |
| Scope creep into video | Not on the schedule. §13. |

---

## 17. Decisions already made — do not relitigate

- Event-based manifest storage, hash in contract storage. §6.1.
- 8 bands × 8 bits, with the scaling limit stated openly. §6.3.
- No fingerprint deduplication at registration. §6.2.
- No ERC-721 anywhere. §1.
- No confidence percentages in the UI. §8.2.
- No protocol fee on licensing. §6.5.
- C2PA-*compatible*, not full C2PA conformance, and say so. §5.3.
- Images only. §13.
- Seed 50k–100k fingerprints before the demo; the Monad argument is demonstrated, not
  asserted. §1.
- Mera belongs in the architecture story, not the integrations list. §1.
