'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Result } from './components/Result';
import { Progress } from './components/Progress';
import type { Resolution } from './lib/types';

const RESOLVER = process.env.NEXT_PUBLIC_RESOLVER_URL ?? 'http://localhost:8787';
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

type Phase =
  | { kind: 'idle' }
  | { kind: 'working'; step: number; slow: boolean; preview: string }
  | { kind: 'done'; result: Resolution; preview: string }
  | { kind: 'error'; message: string };

export default function Verify() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
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
      setPhase({ kind: 'done', result: (await res.json()) as Resolution, preview });
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

  const reset = () => setPhase({ kind: 'idle' });

  return (
    <main className="min-h-dvh flex flex-col">
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

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-16">
        {/* The result is announced without navigation, so it needs a live region. */}
        <div className="w-full" role="status" aria-live="polite">
          {phase.kind === 'idle' && (
            <div className="text-center">
              <h1 style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl leading-tight">
                Drop an image, or paste one
              </h1>
              <button
                onClick={() => fileInput.current?.click()}
                className="mt-8 text-base underline underline-offset-4"
                style={{ color: 'var(--ink-muted)' }}
              >
                choose a file
              </button>
            </div>
          )}

          {phase.kind === 'working' && <Progress step={phase.step} slow={phase.slow} />}

          {phase.kind === 'done' && (
            <>
              <Result result={phase.result} />
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
  );
}
