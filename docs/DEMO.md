# Demo script

Three minutes. Every beat below has been run end to end in a real browser
against the live deployment — nothing here is a promise.

**Record it on [grain-on-monad.vercel.app](https://grain-on-monad.vercel.app)**, not
localhost: passkeys need HTTPS, and judges should see the URL they can visit.

## Before you record

- **Register with your own photo.** A photo you took, not a stock image — this
  is a provenance product, and putting a name on someone else's photograph is
  the one mistake it cannot make on camera.
- **Do registration on your Android phone.** It is the device where the passkey
  path is proven (PRF returned 32 bytes on `/setup`). Screen-record the phone.
- **Open `/` and `/verify` once on the laptop beforehand.** The watermark checker
  is 45 MB and is cached after the first visit; the first check on a fresh
  browser answers by content in seconds and finishes the watermark check later.
- **Prepare the copies for Act 2** from the downloaded `-grain.png`, so you are
  not fiddling with an editor live.

---

## Cold open — 10s

Verify page, empty.

> "This is a photograph I took. I'm going to wreck it five ways, and you'll
> still know who made it."

## Act 1 — Register — 30s, on the phone

1. `/register`, choose the photo.
2. Type your name. The page previews it: *Made by @your-name*.
3. **Register with your fingerprint.** One prompt.
4. *Registered as @your-name.* The marked copy downloads automatically.

> "One fingerprint. No wallet, no seed phrase, no network to pick. The
> watermark went in on my phone — the photo never left it."

## Act 2 — Wreck it — 90s, on the laptop

Drop each copy into Verify. Say which path caught it each time — the honest mix
is the argument.

| Copy | Expected | Say |
|---|---|---|
| Screenshot of it | Made by you — watermark and content | "both paths agree" |
| Cropped about 10% | Made by you — **watermark** | "the crop broke the fingerprint; the watermark held" |
| Saved as a low-quality JPEG | Made by you — **content** | "the compression killed the watermark; the picture itself still matched" |
| Sent through WhatsApp and saved back | Made by you | "a real platform, real recompression" |
| A filter applied | Made by you | |

> "C2PA calls this a durable content credential. What it doesn't say is who
> runs the database you look it up in. This is that database, on Monad — and
> the search you just watched ran in this browser, against the chain, with no
> server of mine in between."

Then click **verify on chain** on one result:

> "And if you don't trust this website, ask the contract. It just returned the
> distance itself."

**Do not demo a 25% crop.** It fails — 19% resolve. If a judge asks where it
breaks, that's the answer, and the full table is in the README.

## Act 3 — The attack — 30s

**The best thirty seconds. Do not cut it.**

1. `/forge`. Enter your record number — it says whose mark you're borrowing.
2. Pick a completely different photo. It copies your watermark onto it.
3. Drop the forged file into Verify.
4. **"This image is claiming someone else's credentials."**

> "A watermark is just a number, and anyone can write any number. This picture
> carries my mark — so a watermark-only system would say I made it. Grain
> checks the picture against the fingerprint I registered, sees it's not mine,
> and refuses."

## Close — 20s

Open your record page, `/r/<your record>`.

> "This is the link I send to anyone who doubts me. Two checks, both against
> the chain: the manifest is the one the contract recorded, and it was signed
> with my key. No company can take it down."

> "Grain. C2PA defined the format. We built the part nobody owns."

---

## If something goes wrong live

- **"Still checking for a hidden watermark"** — first visit on that browser;
  it's downloading the 45 MB checker. Say so; it answers by content meanwhile.
- **A copy resolves by content only** — expected for heavy compression. Narrate
  it: "the watermark's gone on that one, the picture caught it."
- **Passkey error on the laptop** — desktop Chrome saved the passkey to the
  local profile. Do registration on the phone, as planned.

Never apologise for the honest failure modes. A provenance system claiming
100% recovery is lying, and this panel will know.
