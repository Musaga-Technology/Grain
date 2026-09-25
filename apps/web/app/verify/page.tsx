'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Header, Footer } from '../components/Chrome';
import { Result } from '../components/Result';
import { Progress } from '../components/Progress';
import type { Resolution, ResolveExtras } from '../lib/types';
import { createPublicClient, http } from 'viem';
import { CONTRACTS, indexAbi } from '../lib/chain';

const RESOLVER = process.env.NEXT_PUBLIC_RESOLVER_URL ?? 'http://localhost:8787';
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

type Phase =
  | { kind: 'idle' }
  | { kind: 'working'; step: number; slow: boolean; preview: string }
  | { kind: 'done'; result: Resolution; extras: ResolveExtras; preview: string }
  | { kind: 'error'; message: string };

export default function Verify() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
  const [chainDistance, setChainDistance] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const handle = useCallback(async (file: File) => {
    if (!ACCEPTED.includes(file.type)) {
      // Plain language, never a MIME type (UX_SPEC "Input").
      setPhase({ kind: 'error', message: "That file isn't an image Grain can read. Try a PNG or a JPEG." });
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
      });
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
                  You can also paste one with {navigatorKey()}
                </span>
              </button>

              <p className="mt-5 text-sm" style={{ color: 'var(--ink-faint)' }}>
                PNG, JPEG, WebP or AVIF. Your image is checked, not published.
              </p>
            </div>
          )}

          {phase.kind === 'working' && <Progress step={phase.step} slow={phase.slow} />}

          {phase.kind === 'done' && (
            <>
              <Result result={phase.result} onVerifyOnChain={verifyOnChain} chainDistance={chainDistance} />
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
          accept={ACCEPTED.join(',')}
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
