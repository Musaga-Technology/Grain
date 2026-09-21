# UX specification

This expands SPEC.md §8. It is not decoration — the pitch is "provenance that a
photographer can actually use", and that claim is made or broken entirely here.

**The governing rule: zero crypto vocabulary on the primary path.** No "connect
wallet", no gas, no chain IDs, no "sign transaction", no network switching, no
address shown unless asked. If a photographer who has never used crypto can't
register and verify without asking a question, it's wrong.

---

## Routes

| Route | Purpose | Auth | Priority |
|---|---|---|---|
| `/` | Verify | none | P0 |
| `/register` | Register an image | passkey | P0 |
| `/r/[recordId]` | Permanent shareable record | none | P0 |
| `/c/[handle]` | Creator profile | none | P1 |
| `/dashboard` | Signed-in creator's records | passkey | P1 |
| `/sentinel` | Where my work is appearing | passkey | P2 |

P0 is Milestone 2 and is the whole submission if everything else is cut.

---

## `/` — Verify

### Above the fold

One line of instruction and nothing else. No hero copy, no feature grid, no "powered
by" logos, no explanation of what C2PA is. The product explains itself when it works.

```
                    Drop an image, or paste one
```

### Input — three equal paths

1. **Drag and drop anywhere.** The entire viewport is the drop target, not a bordered
   box in the middle. Show the drop state as a full-page treatment.
2. **Clipboard paste (`Cmd/Ctrl+V`), handled at the document level.** This is the
   single most important input path and the one most apps forget. People screenshot
   things and paste them. Listen on `document`, not on a focused input.
3. **File picker** for people who want a button. Small, below the line.

Accept `image/png`, `image/jpeg`, `image/webp`, `image/avif`. Reject anything else
with plain language, not a MIME type.

### Processing

Target under two seconds to a result.

Show a **progress line, not a spinner** — three named steps that tick through:

```
Reading the image  →  Checking the watermark  →  Searching by content
```

The steps are truthful: they map to decode, TrustMark decode, and the fingerprint
fan-out. If the whole thing runs past four seconds, show which step is outstanding
rather than a generic wait. Never show a percentage bar for work you can't measure.

### Output — one answer, large

```
                      Made by  Ana Ruiz
                    registered 12 days ago

              matched by watermark and content
                    verify on chain ↗
```

- **Creator name is the headline.** Links to `/c/[handle]`.
- **Relative time is the subhead.** "12 days ago", not a timestamp.
- The block number lives **underneath as a small timestamp link**, not as a labelled
  field. Someone who cares can click it. Nobody else sees a blockchain.
- **`via` is stated plainly** — "matched by watermark and content", "matched by
  content" — because the honest mix is more convincing than a claimed 100% and it
  shows the two paths are co-equal.
- **`verify on chain`** calls `FingerprintIndex.verify()` directly from the browser
  and shows the distance the contract returned. This is how you answer a sceptic
  live, and it's how you prove the indexer isn't lying.

### Forbidden in this view

- **No confidence percentage.** "87% match" invites an argument you cannot win in
  front of judges. Matched, or not.
- No raw addresses on the primary view.
- No transaction hashes on the primary view.
- No "powered by Monad" badge. The chain shows up in the timestamp link, which is
  more confident than a logo.

---

## The four states

Each needs a distinct treatment. A person should know which one they're looking at
from across a room, with the text unreadable.

### `RESOLVED`

Calm, confident, neutral surface. Headline **Made by {name}**. Body: how it matched,
when it was registered. This is the common case and it should feel unremarkable —
the product working is not an event.

### `UNCERTAIN`

Distance between `MATCH_THRESHOLD` and `TAMPER_THRESHOLD`. Same layout as RESOLVED,
with a caveat line:

> **Probably made by Ana Ruiz**
> This copy has been heavily edited. The match is close but not exact.

Still no percentage. "Close but not exact" is honest and unarguable.

### `TAMPERED` — the demo moment

**This is the only place the accent colour is used at full strength.** It should feel
like an alarm.

> **This image is claiming someone else's credentials**
> It carries Ana Ruiz's watermark, but the picture doesn't match what Ana registered.
> Someone copied the mark onto a different image.

Show both: what was claimed, and the distance. Offer `verify on chain` prominently
here — a judge will want to see the contract confirm it.

### `NOT_FOUND`

Quiet. **Must not look like an error.** No red, no warning icon, no "failed".

> **No record for this image**
> It may never have been registered, or it's been edited past recognition.
>
> Register an image →

Most images on earth are unregistered. That's the starting condition of the whole
project, not a bug. Treating it as a failure state makes the product feel broken on
the very first thing most people will drop into it.

---

## `/register`

The entire flow is: choose image → one biometric prompt → done. Anything else added
here is a mistake.

### Steps

1. **Drop or pick an image.** Preview immediately, large.
2. **Optional title.** One field. No tags, no categories, no description, no
   licence terms in v1 — licence price lives on the profile, not per-image.
3. **One button: "Register with Face ID"** (adapt the label per platform — Touch ID,
   Windows Hello, "your passkey" as the generic fallback).
4. **The passkey prompt.** This is the only authentication step in the product.
5. Work happens in-browser: watermark embedded, fingerprint computed, manifest built
   and signed, transaction sent. Same three-step progress line pattern as verify.
6. **The watermarked file downloads automatically**, `{originalname}-grain.png`,
   with an unmissable line:

   > **Use this copy from now on** — it's the one that carries the mark.

   Getting this wrong means users publish the un-watermarked original and the product
   silently doesn't work for them. Consider also offering a "download again" on the
   record page permanently.
7. **Result:** redirect to `/r/[id]` with a copy-link button.

### First-run vs returning

- **First visit:** `createPasskeyWithPrfOutput`. Store `credentialId` and
  `transports` in `localStorage` — that metadata holds no key material.
- **Returning:** `getPasskeyPrfOutput` with the stored credential, so the browser
  goes straight to the right passkey instead of asking the user to pick one.
- **Never** show "create account" and "sign in" as separate choices. The app knows
  which one it is.

### Error copy — plain language, no error codes on screen

The one that will actually happen:

> **Your browser saved this passkey somewhere Grain can't use.**
> Save it to Google Password Manager instead, or use Safari, iOS, or 1Password.

(`PRF_UNAVAILABLE` — desktop Chrome saving to the local profile. Log the code to the
console for yourself; never put it in front of the user.)

Others to write copy for: aspect ratio beyond 2:1 (watermark will be weak, we'll rely
on content matching), file too large, unsupported format, transaction failed
(offer retry, never lose their image).

---

## `/r/[recordId]`

A permanent, shareable page. This is what a creator sends to someone who doubts them,
so it needs to be legible to a stranger with no context.

- The image (or a thumbnail if we don't host it — decide and be consistent).
- Made by, when, how many times superseded.
- The manifest, rendered readably, with a "show raw" toggle.
- Supersession chain if any — "edited twice, this is the current version".
- `verify on chain` link.
- Open Graph tags so the link previews properly when pasted into Slack or X. Small
  thing, disproportionate effect when a judge shares it.

---

## Design direction

Restrained and editorial — closer to a photography publication than a crypto dapp.
Reference points: the Content Authenticity Initiative's own tooling, Are.na,
Readymag, Cosmos.

**Concretely:**

- **One accent colour, used almost nowhere.** It is reserved for `TAMPERED`. If it
  appears on buttons and links too, the alarm state doesn't land.
- Real typographic hierarchy. One serif or one distinctive sans, used at genuinely
  different sizes. Images shown large.
- Generous whitespace. The verify page should look nearly empty before you drop
  something on it.
- Dark mode via `prefers-color-scheme`, tokens on `:root`, **no toggle** — a toggle
  is a settings surface, and we don't have settings.
- **No gradients, no glassmorphism, no animated backgrounds, no 3D, no particle
  effects, no scroll-jacking.** Every one of these reads as crypto-dapp and works
  against the pitch.
- Motion only where it's functional: the drop state, the progress line, the state
  transition on the result. Nothing decorative. Respect
  `prefers-reduced-motion`.

**Mobile-first.** At least one judge will open this on a phone. Paste and file-pick
both need to work on iOS Safari; drag-and-drop does not exist there, so the layout
cannot depend on it.

---

## Accessibility (do not skip, it's twenty minutes)

- Every state announced to screen readers via a live region — the result appears
  without navigation, so it must be announced.
- The drop zone reachable and operable by keyboard alone.
- Contrast ratios met, including the accent on the TAMPERED surface.
- Focus visible everywhere, never removed.
- The image preview needs alt text; use the title field when given, "uploaded image"
  when not.

---

## Copy principles

- **Say what happened, not what the system did.** "Made by Ana Ruiz", not "Manifest
  resolved successfully".
- **Never make the user feel at fault.** `NOT_FOUND` is about the image, not them.
- **No exclamation marks.** This is a tool about evidence.
- **Name the human, not the address.** Fall back to a shortened address only when
  there's no handle, and label it "unnamed creator" rather than showing `0x1234…`
  as if it were a name.
