'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { decodeImage, encodePNG } from '@grain/core';
import { Header, Footer } from '../components/Chrome';
import { encodeWatermark, canWatermark, prefetch } from '../lib/trustmark';
import { readRecord } from '../lib/resolve-client';
import { handleOf } from '../lib/creators';

/**
 * Try to fool it.
 *
 * The attack Grain is built to catch: a TrustMark payload is not authenticated,
 * so anyone can stamp a real record's id onto a different picture. This page
 * does exactly that, in the browser, so a sceptic can run the attack themselves
 * instead of taking a demo's word for it -- then drop the result into Verify and
 * watch the fingerprint cross-check refuse it.
 *
 * Nothing here is a new capability: the encoder is open source and the payload
 * format is public. Hiding the attack would not stop anyone; showing it is the
 * honest way to demonstrate the defence.
 */

type Phase =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; url: string; filename: string; recordId: string; handle?: string }
  | { kind: 'error'; message: string };

export default function Forge() {
  const [recordId, setRecordId] = useState('508');
  const [target, setTarget] = useState<{ handle?: string; ok: boolean } | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { prefetch('register'); }, []);

  // Show whose credentials are about to be borrowed.
  useEffect(() => {
    if (!/^\d+$/.test(recordId)) { setTarget(null); return; }
    let live = true;
    void readRecord(BigInt(recordId)).then(async (r) => {
      if (!live) return;
      setTarget(r ? { ok: true, handle: await handleOf(r.creator) } : { ok: false });
    }).catch(() => live && setTarget({ ok: false }));
    return () => { live = false; };
  }, [recordId]);

  const forge = useCallback(async (file: File) => {
    if (!target?.ok) return;
    setPhase({ kind: 'working' });
    try {
      const img = decodeImage(new Uint8Array(await file.arrayBuffer()));
      if (!canWatermark(img)) {
        setPhase({ kind: 'error', message: 'That image is wider than 2:1, which TrustMark cannot mark well. Try another.' });
        return;
      }
      const marked = await encodeWatermark(img, BigInt(recordId));
      const url = URL.createObjectURL(new Blob([encodePNG(marked) as BlobPart], { type: 'image/png' }));
      const filename = file.name.replace(/(\.\w+)?$/, `-forged-${recordId}.png`);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      setPhase({ kind: 'done', url, filename, recordId, handle: target.handle });
    } catch {
      setPhase({ kind: 'error', message: "Grain couldn't read that image. Try a PNG or a JPEG." });
    }
  }, [recordId, target]);

  const who = target?.handle ? `@${target.handle}` : 'that creator';

  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-xl px-5 py-14 sm:py-20">
        <h1 style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl leading-tight">Try to fool it</h1>
        <p className="mt-4 text-base leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          A watermark only carries a number, and anyone can write any number into any picture. So copy a
          real creator&rsquo;s mark onto an image of your own, then ask Grain who made it.
        </p>

        {phase.kind !== 'done' && (
          <>
            <label className="block mt-9">
              <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>Whose mark to copy (a record number)</span>
              <input value={recordId} onChange={(e) => setRecordId(e.target.value.trim())} inputMode="numeric"
                     className="mt-2 w-full rounded-lg px-4 py-3 text-base bg-transparent border font-mono"
                     style={{ borderColor: 'var(--rule)' }} />
              <span className="mt-2 block text-sm" style={{ color: 'var(--ink-faint)' }}>
                {target === null ? ' ' : target.ok
                  ? <>You&rsquo;ll be borrowing the mark of <span style={{ color: 'var(--ink)' }}>{target.handle ? `@${target.handle}` : 'an unnamed creator'}</span>.</>
                  : 'No record with that number.'}
              </span>
            </label>

            <button onClick={() => input.current?.click()} disabled={!target?.ok || phase.kind === 'working'}
                    className="grain-btn mt-7 w-full rounded-full px-6 py-4 text-base font-medium disabled:opacity-40">
              {phase.kind === 'working' ? 'Copying the mark…' : 'Choose your image and copy the mark onto it'}
            </button>
            {phase.kind === 'error' && <p className="mt-4 text-[15px]">{phase.message}</p>}
          </>
        )}

        {phase.kind === 'done' && (
          <div className="grain-rise mt-9">
            <img src={phase.url} alt="Your image, now carrying a copied mark"
                 className="w-full rounded-lg border" style={{ borderColor: 'var(--rule)' }} />
            <p className="mt-6 text-base leading-relaxed">
              Downloaded <span className="font-mono text-[14px]">{phase.filename}</span>. It now carries {phase.handle ? `@${phase.handle}` : 'that creator'}&rsquo;s
              watermark — a decoder that only reads the mark would say {phase.handle ? `@${phase.handle}` : 'they'} made it.
            </p>
            <Link href="/verify" className="grain-btn inline-block mt-7 px-6 py-3 rounded-full text-base font-medium">
              Now drop it into Verify &rarr;
            </Link>
            <p className="mt-4 text-sm" style={{ color: 'var(--ink-faint)' }}>
              Grain compares the picture against the fingerprint {phase.handle ? `@${phase.handle}` : 'the creator'} registered,
              sees they don&rsquo;t match, and refuses.
            </p>
          </div>
        )}

        <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only"
               onChange={(e) => { const f = e.target.files?.[0]; if (f) void forge(f); e.target.value = ''; }} />
        <p className="mt-12 text-xs leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
          Nothing here is new: the watermark encoder is open source and its payload format is public. Showing the
          attack is the honest way to show the defence.
        </p>
      </main>
      <Footer />
    </div>
  );
}
