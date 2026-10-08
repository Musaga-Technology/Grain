'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Header, Footer } from '../components/Chrome';
import { Result } from '../components/Result';
import { Progress } from '../components/Progress';
import type { Resolution, ResolveExtras } from '../lib/types';
import { createPublicClient, http } from 'viem';
import { CONTRACTS, indexAbi } from '../lib/chain';
import { resolveProgressive } from '../lib/resolve-client';
import { prefetch } from '../lib/trustmark';

/**
 * When a resolver is configured, it runs both paths server-side. When it is not
 * -- which is the free production deployment -- the browser runs the
 * fingerprint path itself (see lib/resolve-client.ts).
 */
const RESOLVER = process.env.NEXT_PUBLIC_RESOLVER_URL;

/**
 * PNG and JPEG only. grain-core owns both decoders so the fingerprint is
 * identical in every browser; WebP and AVIF would need the platform's decoder,
 * which is exactly the source of drift the fingerprint is built to avoid.
 */
const ACCEPTED = ['image/png', 'image/jpeg'];

/**
 * Everything else the browser can decode -- WebP above all, which is what most
 * image links on the web actually serve -- is converted to PNG first, using the
 * browser's own decoder. That adds the platform drift ACCEPTED avoids, but only
 * a few bits of it, well inside the match threshold; refusing WebP would make
 * checking an image from the web fail most of the time.
 */
async function readable(file: File): Promise<File | null> {
  if (ACCEPTED.includes(file.type)) return file;
  if (!file.type.startsWith('image/')) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    return blob ? new File([blob], file.name.replace(/(\.\w+)?$/, '.png'), { type: 'image/png' }) : null;
  } catch {
    return null;
  }
}

/**
 * An image from a link. Straight from the site when it allows that (CORS);
 * otherwise through /api/fetch-image, which most sites need.
 */
async function fetchImage(link: string): Promise<File> {
  const name = (() => { try { return new URL(link).pathname.split('/').pop() || 'image'; } catch { return 'image'; } })();
  try {
    const direct = await fetch(link, { mode: 'cors' });
    if (direct.ok && (direct.headers.get('content-type') ?? '').startsWith('image/')) {
      const blob = await direct.blob();
      return new File([blob], name, { type: blob.type });
    }
  } catch { /* no CORS: go through Grain */ }
  const res = await fetch(`/api/fetch-image?url=${encodeURIComponent(link)}`);
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? "Grain couldn't fetch that image.");
  }
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type });
}

/**
 * Ready-made copies for a visitor with no image to hand. All four come from
 * one procedurally generated artwork registered as @grain-studio (record 511),
 * so the attribution they resolve to is true. scripts/make-sample-art.ts makes
 * the art; each copy is a real, measured outcome rather than a scripted one.
 */
const SAMPLES = [
  {
    id: 'reposted', label: 'A reposted copy', file: '/samples/reposted.jpg',
    explain: 'Re-encoded as a JPEG, the way any repost is. The file’s credentials are gone, but the watermark and the picture both lead back to the record.',
  },
  {
    id: 'squashed', label: 'Filtered and crushed', file: '/samples/squashed.jpg',
    explain: 'Filtered, halved and compressed to 8 KB. That destroyed the watermark, so Grain found the record from the picture itself.',
  },
  {
    id: 'forged', label: 'A forged credential', file: '/samples/forged.jpg',
    explain: 'Someone stamped @grain-studio’s watermark onto a different picture. The mark points to the record, but the picture doesn’t match it — so Grain refuses to attribute it.',
  },
  {
    id: 'unregistered', label: 'Never registered', file: '/samples/unregistered.jpg',
    explain: 'Nobody has registered this picture, and Grain says so rather than guessing.',
  },
] as const;
type Sample = (typeof SAMPLES)[number];

type Phase =
  | { kind: 'idle' }
  | { kind: 'working'; step: number; slow: boolean; preview: string }
  | { kind: 'done'; result: Resolution; extras: ResolveExtras; preview: string; watermarkPending?: boolean; sample?: Sample }
  | { kind: 'error'; message: string };

export default function Verify() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
  const [chainDistance, setChainDistance] = useState<number | null>(null);
  // Resolved after mount: the server cannot know the platform, and rendering a
  // guess there made the hydrated text disagree with the server's.
  const [pasteKey, setPasteKey] = useState('Ctrl+V');
  useEffect(() => { setPasteKey(navigatorKey()); }, []);

  // The watermark decoder is 45 MB. Start fetching it the moment someone
  // arrives, so it is usually ready by the time they have chosen an image.
  useEffect(() => { if (!RESOLVER) prefetch('verify'); }, []);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const handle = useCallback(async (picked: File, sample?: Sample) => {
    const file = await readable(picked);
    if (!file) {
      // Plain language, never a MIME type (UX_SPEC "Input").
      setPhase({ kind: 'error', message: "Grain can't read that file as an image. Try a PNG or JPEG." });
      return;
    }

    const preview = URL.createObjectURL(file);
    setPhase({ kind: 'working', step: 0, slow: false, preview });

    // The steps are truthful, not theatre: decode, then the watermark and the
    // fingerprint fan-out running together on the server.
    const toStep1 = setTimeout(() => setPhase((p) => (p.kind === 'working' ? { ...p, step: 1 } : p)), 400);
    const toStep2 = setTimeout(() => setPhase((p) => (p.kind === 'working' ? { ...p, step: 2 } : p)), 1600);
    const toSlow = setTimeout(() => setPhase((p) => (p.kind === 'working' ? { ...p, slow: true } : p)), 4000);

    try {
      if (RESOLVER) {
        const body = new FormData();
        body.append('image', file);
        const res = await fetch(`${RESOLVER}/v1/resolve`, { method: 'POST', body });
        if (!res.ok) throw new Error(String(res.status));
        const payload = (await res.json()) as Resolution & ResolveExtras;
        setPhase({
          kind: 'done',
          result: payload,
          extras: { queryFingerprint: payload.queryFingerprint, candidatesExamined: payload.candidatesExamined },
          preview,
          sample,
        });
      } else {
        // In-browser: nothing is uploaded. May report twice -- see resolveProgressive.
        await resolveProgressive(file, (u) => {
          const result = JSON.parse(JSON.stringify(u.resolution,
            (_, v) => (typeof v === 'bigint' ? v.toString() : v))) as Resolution;
          setChainDistance(null);
          setPhase({
            kind: 'done',
            result,
            extras: {
              queryFingerprint: `0x${u.queryFingerprint.toString(16).padStart(16, '0')}`,
              candidatesExamined: u.candidatesExamined,
            },
            preview,
            watermarkPending: u.watermarkPending,
            sample,
          });
        });
      }
    } catch {
      setPhase({
        kind: 'error',
        message: "Grain couldn't check that image just now. Your image is fine — try again in a moment.",
      });
    } finally {
      clearTimeout(toStep1); clearTimeout(toStep2); clearTimeout(toSlow);
    }
  }, []);

  /*
   * CLIPBOARD PASTE, HANDLED AT THE DOCUMENT LEVEL.
   * People screenshot things and paste them. Listening on `document` rather
   * than a focused input is what makes this work without the user first
   * clicking anything.
   */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); void handle(file); }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [handle]);

  /* The entire viewport is the drop target, not a bordered box in the middle. */
  useEffect(() => {
    const onOver = (e: DragEvent) => e.preventDefault();
    const onEnter = (e: DragEvent) => { e.preventDefault(); dragDepth.current++; setDragging(true); };
    const onLeave = (e: DragEvent) => {
      e.preventDefault();
      if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault(); dragDepth.current = 0; setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) void handle(file);
    };
    document.addEventListener('dragover', onOver);
    document.addEventListener('dragenter', onEnter);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('dragenter', onEnter);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [handle]);

  const trySample = useCallback(async (sample: Sample) => {
    try {
      const blob = await (await fetch(sample.file)).blob();
      await handle(new File([blob], sample.file.split('/').pop()!, { type: 'image/jpeg' }), sample);
    } catch {
      setPhase({ kind: 'error', message: "That sample didn't load. Try another, or use an image of your own." });
    }
  }, [handle]);

  const [link, setLink] = useState('');
  const checkLink = useCallback(async (url: string) => {
    setPhase({ kind: 'working', step: 0, slow: false, preview: url });
    try {
      await handle(await fetchImage(url));
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
    }
  }, [handle]);

  // /verify?sample=forged opens straight onto a sample: for links from the
  // landing page, and for showing someone the product in one click.
  // /verify?url=... checks an image from the web: what the browser extension opens.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sample = SAMPLES.find((x) => x.id === params.get('sample'));
    if (sample) void trySample(sample);
    const url = params.get('url');
    if (url && /^https?:\/\//i.test(url)) { setLink(url); void checkLink(url); }
  }, [trySample, checkLink]);

  /*
   * Tell the creator their work was checked: the record number and the
   * verdict, nothing else (see app/lib/activity). Once per check, on the final
   * answer only, and never for the demo samples -- those are not real-world
   * encounters with anyone's work.
   */
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (phase.kind !== 'done' || phase.watermarkPending || phase.sample || reported.current === phase.preview) return;
    reported.current = phase.preview;
    const r = phase.result;
    const recordId = r.state === 'RESOLVED' ? r.record.recordId
      : r.state === 'TAMPERED' ? r.claimed.recordId
      : r.state === 'UNCERTAIN' ? r.candidates[0]?.recordId : undefined;
    if (recordId === undefined) return;
    void fetch('/api/activity', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordId: String(recordId), verdict: r.state }), keepalive: true,
    }).catch(() => {});
  }, [phase]);

  const reset = () => { setChainDistance(null); setPhase({ kind: 'idle' }); };

  /*
   * Ask the contract directly, from the browser, bypassing the resolver
   * entirely. This is how a sceptic confirms the indexer is not lying, and it
   * is the operable answer to "why not just a database" -- a database cannot
   * let you check its answer without trusting whoever served it.
   */
  const verifyOnChain = useCallback(async () => {
    if (phase.kind !== 'done') return;
    const record =
      phase.result.state === 'RESOLVED' ? phase.result.record
      : phase.result.state === 'TAMPERED' ? phase.result.claimed
      : phase.result.state === 'UNCERTAIN' ? phase.result.candidates[0]
      : null;
    if (!record) return;

    try {
      const client = createPublicClient({ transport: http(process.env.NEXT_PUBLIC_RPC_URL) });
      const distance = await client.readContract({
        address: CONTRACTS.FingerprintIndex,
        abi: indexAbi,
        functionName: 'verify',
        args: [BigInt(record.recordId), BigInt(phase.extras.queryFingerprint)],
      });
      setChainDistance(Number(distance));
    } catch {
      setChainDistance(null);
    }
  }, [phase]);

  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col">
      {dragging && (
        <div
          aria-hidden
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'var(--paper)', opacity: 0.97 }}
        >
          <p style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl">
            Drop it anywhere
          </p>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-14 sm:py-20">
        {/* The result is announced without navigation, so it needs a live region. */}
        <div className="w-full" role="status" aria-live="polite">
          {phase.kind === 'idle' && (
            <div className="w-full max-w-xl mx-auto text-center grain-rise">
              <h1 style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl leading-tight">
                Check an image
              </h1>
              <p className="mt-3 text-base" style={{ color: 'var(--ink-muted)' }}>
                Find out who made it, even if it&rsquo;s been screenshotted or edited.
              </p>

              {/* A visible target. The whole viewport still accepts a drop and
                  paste still works anywhere, but a box people can see is more
                  discoverable than a convention they have to already know. */}
              <button
                onClick={() => fileInput.current?.click()}
                className="grain-card mt-9 w-full rounded-xl px-6 py-12 flex flex-col items-center gap-5 cursor-pointer"
                style={{ borderStyle: 'dashed' }}
              >
                <Image src="/illustrations/creating.svg" alt="" width={180} height={120}
                       className="h-24 w-auto" />
                <span className="text-base font-medium">Drop an image here, or click to choose</span>
                <span className="text-sm" style={{ color: 'var(--ink-faint)' }}>
                  You can also paste one with {pasteKey}
                </span>
              </button>

              <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (/^https?:\/\//i.test(link.trim())) void checkLink(link.trim()); }}>
                <input value={link} onChange={(e) => setLink(e.target.value)} type="url" inputMode="url"
                       placeholder="or paste an image link"
                       className="min-w-0 flex-1 rounded-full border bg-transparent px-4 py-2.5 text-sm"
                       style={{ borderColor: 'var(--rule)' }} />
                <button type="submit" disabled={!/^https?:\/\//i.test(link.trim())}
                        className="rounded-full border px-4 py-2.5 text-sm disabled:opacity-40"
                        style={{ borderColor: 'var(--rule)' }}>
                  Check
                </button>
              </form>

              <p className="mt-5 text-sm" style={{ color: 'var(--ink-faint)' }}>
                Your image is checked on your own device and never uploaded. A link is fetched for you, not stored.{' '}
                <a href="/extension" className="underline underline-offset-4">Check images right from any page</a>.
              </p>

              <div className="mt-12 text-left">
                <p className="text-sm font-medium">No image handy? Try one of these</p>
                <ul className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {SAMPLES.map((sample) => (
                    <li key={sample.id}>
                      <button onClick={() => void trySample(sample)}
                              className="grain-sample group w-full text-left rounded-lg overflow-hidden border cursor-pointer"
                              style={{ borderColor: 'var(--rule)', background: 'var(--surface)' }}>
                        <Image src={sample.file} alt="" width={240} height={160}
                               className="w-full aspect-[3/2] object-cover transition-transform duration-300 group-hover:scale-105" />
                        <span className="block px-3 py-2 text-[13px] leading-snug">{sample.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {phase.kind === 'working' && <Progress step={phase.step} slow={phase.slow} />}

          {phase.kind === 'done' && (
            <>
              {/* The picture beside the answer: the whole product in one glance. */}
              <div className="w-full max-w-5xl mx-auto grid gap-2 md:gap-6 md:grid-cols-2 md:items-center px-1">
                <figure className="grain-rise px-6 md:px-0">
                  <img
                    src={phase.preview}
                    alt="The image you checked"
                    className="w-full max-h-[55vh] object-contain rounded-lg border"
                    style={{
                      borderColor: phase.result.state === 'TAMPERED' ? 'var(--accent)' : 'var(--rule)',
                      background: 'var(--surface)',
                    }}
                  />
                </figure>
                <div>
                  <Result result={phase.result} onVerifyOnChain={verifyOnChain} chainDistance={chainDistance} />
                  {phase.sample && !phase.watermarkPending && (
                    <div className="grain-rise mx-6 -mt-2 mb-6 rounded-lg px-4 py-3 text-[14px] leading-relaxed"
                         style={{ background: 'var(--brand-soft)' }}>
                      <span className="font-medium">What just happened: </span>{phase.sample.explain}
                    </div>
                  )}
                  {phase.watermarkPending && (
                    // Honest about what is still running: this answer came from
                    // the picture alone, and the watermark check can change it.
                    <p className="grain-pulse px-6 -mt-4 text-sm" style={{ color: 'var(--ink-faint)' }}>
                      Still checking for a hidden watermark — the first check on a new device takes a little longer.
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-10 text-center">
                <button onClick={reset} className="text-sm underline underline-offset-4"
                        style={{ color: 'var(--ink-faint)' }}>
                  check another image
                </button>
              </div>
            </>
          )}

          {phase.kind === 'error' && (
            <div className="grain-rise w-full max-w-xl mx-auto px-6 text-center">
              {/* Never make the user feel at fault. */}
              <p className="text-lg leading-relaxed">{phase.message}</p>
              <button onClick={reset} className="mt-6 text-sm underline underline-offset-4"
                      style={{ color: 'var(--ink-faint)' }}>
                try again
              </button>
            </div>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handle(f); e.target.value = ''; }}
        />
      </div>
      </main>
      <Footer />
    </div>
  );
}

/** Mac users expect Cmd, everyone else Ctrl. */
function navigatorKey(): string {
  if (typeof navigator === 'undefined') return 'Ctrl+V';
  return /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent) ? '\u2318V' : 'Ctrl+V';
}
