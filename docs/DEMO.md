# Demo script

Target 3 minutes. Rehearse at least five times — the abuse sequence must be muscle
memory, because fumbling it live is worse than not doing it.

Record in one take if you can. Judges can tell when a provenance demo has been cut,
and the irony is not lost on anyone.

---

## Cold open (10s)

No logo, no title card. Start on the verify page with a photo already in hand.

> "This is a photograph. By the end of this video I'm going to destroy it five
> different ways, and you'll still know who took it."

---

## Act 1 — Register (30s)

1. Drop the photo on `/register`.
2. Type a title. Nothing else.
3. Click **Register with Face ID**. One biometric prompt.
4. Registered. Block number visible. Watermarked file downloads.

> "One prompt. No seed phrase, no wallet connection, no network switch. That's the
> whole onboarding — and there's no crypto vocabulary anywhere on this path."

**Say the quiet part out loud:** no wallet UI appeared. Judges have watched forty
demos that opened with a connect-wallet modal.

---

## Act 2 — Abuse it (90s)

Do all of this live, on camera, to the registered image. Never cut.

| # | Attack | Expected |
|---|---|---|
| 1 | Screenshot it | resolves |
| 2 | Crop 25% | resolves |
| 3 | Crush to JPEG Q40 | resolves |
| 4 | Run a filter over it | resolves |
| 5 | Push through a real platform and download it back | resolves |

Drop each mangled copy into Verify. Each returns **Made by {name}**.

**Show which path won each time** — "that one was the watermark, this one the
watermark was gone and it matched on content alone." The honest mix is more
convincing than a claimed 100%, and it demonstrates that the two paths are
co-equal rather than primary-and-fallback.

> "The manifest is stripped out of every one of these files. C2PA calls the fix a
> durable credential — a watermark or a fingerprint that survives the copy. What
> C2PA doesn't say is who runs the database you look it up in. Right now that's
> Adobe, or Digimarc. This is that database, on Monad, and nobody can delete your
> row."

---

## Interlude — the scale beat (15s)

Show the registry size on screen before Act 3. One sentence, no ceremony:

> "There are ninety thousand images in this registry, and every one of those searches
> just ran on chain, inside a block."

This is the moment the Monad argument stops being a slide and becomes a thing the
judges watched happen. Do not skip it and do not oversell it — say the number, move on.

---

## Act 3 — The attack (30s)

**The best thirty seconds. Do not cut this for time.**

1. Lift the watermark from the registered image, paste it onto a completely
   different picture.
2. Drop it in.
3. **TAMPERED.** "It's carrying Ana's mark, but it isn't Ana's picture."
4. Hit **verify on chain** so the contract itself returns the distance.

> "Watermarks can be transferred — that's a known attack, and most provenance demos
> don't show it because most provenance demos don't handle it. The manifest carries
> a fingerprint of the original. If the mark says one thing and the picture says
> another, we refuse."

---

## Coda — the agent (30s)

Terminal:

```
$ mm grain verify ./found-image.jpg
  Made by @anaruiz · registered 12 days ago · licence 2 USDC

$ mm grain license ./found-image.jpg
  Paid @anaruiz 2 USDC on Monad · licence recorded · 0.4s
```

Then the photographer's `/sentinel` page: where their work appeared this week, and
whether it was paid for.

> "This is a MetaMask Agent Wallet plugin. The agent found an image, checked who
> made it, and paid them — inside a spending limit it cannot exceed, on a wallet
> that can't touch my main funds. The registry is what makes that payment possible,
> because without it the agent has nobody to pay."

---

## Close (10s)

> "Grain. C2PA already defined the format. We built the part nobody owns."

---

## If something breaks live

- **Envio down** → the resolver falls back to direct chain reads. Say so and keep
  going; it's a better moment than a rehearsed one.
- **Watermark misses on a transformation** → expected on some, that's the point of
  two paths. Narrate it: "watermark's gone on that one, content match caught it."
- **PRF_UNAVAILABLE** → you are on the wrong browser. This is why Milestone 0
  tests the demo machine.

Never apologise for the honest failure modes. A provenance system that claims 100%
recovery is lying, and the judges on this panel will know it.
