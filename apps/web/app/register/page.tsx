'use client';

import { useCallback, useRef, useState } from 'react';
import Image from 'next/image';
import { createWalletClient, custom, http, bytesToHex, type Hex } from 'viem';
import {
  decodeImage, fingerprint, buildManifest, signManifestWith, encodeSignedManifest,
  aspectRatioWarning,
} from '@grain/core';
import { Header, Footer } from '../components/Chrome';
import { identitySession, PasskeyUnavailable, storedCredential } from '../lib/mera';
import { monadTestnet, CONTRACTS, registryAbi } from '../lib/chain';

/**
 * Register an image.
 *
 * The entire flow is: choose image -> one biometric prompt -> done. Anything
 * else added here is a mistake (UX_SPEC /register).
 *
 * The ordering is forced by measurement, not preference. The watermark carries
 * the recordId, so the id must be reserved first. The fingerprint that goes on
 * chain has to be the WATERMARKED file's, because that is what the anti-spoof
 * check compares against — and embedding moves the fingerprint by up to 4 bits
 * of a 7-bit budget (docs/ROBUSTNESS.md). So: reserve, mark, fingerprint, sign,
 * register.
 */

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

type Phase =
  | { kind: 'choosing' }
  | { kind: 'ready'; file: File; preview: string; wideRatio: boolean }
  | { kind: 'working'; message: string; preview: string }
  | { kind: 'done'; recordId: string; preview: string; filename: string }
  | { kind: 'error'; message: string; preview?: string };

export default function Register() {
  const [phase, setPhase] = useState<Phase>({ kind: 'choosing' });
  const [title, setTitle] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const choose = useCallback(async (file: File) => {
    if (!ACCEPTED.includes(file.type)) {
      setPhase({ kind: 'error', message: "That file isn't an image Grain can read. Try a PNG or a JPEG." });
      return;
    }
    const preview = URL.createObjectURL(file);
    let wideRatio = false;
    try {
      const img = decodeImage(new Uint8Array(await file.arrayBuffer()));
      wideRatio = aspectRatioWarning(img.width, img.height);
    } catch { /* preview still works; the real decode happens server-side */ }
    setPhase({ kind: 'ready', file, preview, wideRatio });
  }, []);

  const register = useCallback(async (file: File, preview: string) => {
    const step = (message: string) => setPhase({ kind: 'working', message, preview });

    let session;
    try {
      step(storedCredential() ? 'Waiting for your passkey' : 'Creating your passkey');
      // The only authentication step in the product. No seed phrase, no wallet
      // connection, no network prompt.
      session = await identitySession(title || undefined);
    } catch (e) {
      const message = e instanceof PasskeyUnavailable
        ? e.message
        : "Grain couldn't use your passkey just now. Try again.";
      setPhase({ kind: 'error', message, preview });
      return;
    }

    try {
      // A passkey-derived account starts empty and the person has no way to
      // fund it. See app/api/fund for why this exists rather than a relayer.
      step('Setting up your account');
      await fetch('/api/fund', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: session.account.address }),
      });

      step('Adding the invisible mark');
      const form = new FormData();
      form.append('image', file);
      const marked = await fetch('/api/prepare', { method: 'POST', body: form });
      if (!marked.ok) throw new Error('prepare failed');

      const recordId = BigInt(marked.headers.get('x-grain-record-id') ?? '0');
      const markedBytes = new Uint8Array(await marked.arrayBuffer());

      step('Fingerprinting your image');
      const fp = fingerprint(decodeImage(markedBytes));

      step('Signing');
      const manifest = await signManifestWith(
        buildManifest({
          recordId,
          creator: session.account.address as Hex,
          fingerprint: fp,
          title: title || undefined,
          generator: 'Grain Web 0.1.0',
        }),
        session.account,
      );

      step('Recording it');
      const wallet = createWalletClient({
        account: session.account,
        chain: monadTestnet,
        transport: http(process.env.NEXT_PUBLIC_RPC_URL),
      });
      await wallet.writeContract({
        address: CONTRACTS.GrainRegistry,
        abi: registryAbi,
        functionName: 'register',
        args: [recordId, fp, bytesToHex(encodeSignedManifest(manifest))],
      });

      // THE WATERMARKED FILE DOWNLOADS AUTOMATICALLY. Getting this wrong means
      // people publish the unmarked original and the product silently does not
      // work for them.
      const filename = file.name.replace(/(\.\w+)?$/, '-grain.png');
      const url = URL.createObjectURL(new Blob([markedBytes as BlobPart], { type: 'image/png' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);

      setPhase({ kind: 'done', recordId: recordId.toString(), preview, filename });
    } catch (e) {
      console.error(e);
      setPhase({
        kind: 'error',
        message: "Something went wrong recording your image. Your image is safe — try again.",
        preview,
      });
    } finally {
      session.end();
    }
  }, [title]);

  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col items-center justify-center px-5 py-14 sm:py-20">
        <div className="w-full max-w-xl" role="status" aria-live="polite">

          {phase.kind === 'choosing' && (
            <div className="text-center grain-rise">
              <h1 style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl leading-tight">
                Register an image
              </h1>
              <p className="mt-3 text-base" style={{ color: 'var(--ink-muted)' }}>
                One prompt. No wallet, no seed phrase, no account to create.
              </p>
              <button
                onClick={() => fileInput.current?.click()}
                className="grain-card mt-9 w-full rounded-xl px-6 py-12 flex flex-col items-center gap-5"
                style={{ borderStyle: 'dashed' }}
              >
                <Image src="/illustrations/creating.svg" alt="" width={180} height={120} className="h-24 w-auto" />
                <span className="text-base font-medium">Choose an image</span>
              </button>
            </div>
          )}

          {phase.kind === 'ready' && (
            <div className="grain-rise">
              <img src={phase.preview} alt={title || 'Image to register'}
                   className="w-full rounded-lg border" style={{ borderColor: 'var(--rule)' }} />

              {phase.wideRatio && (
                <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                  This image is very wide. The invisible mark works less well on shapes like this,
                  so Grain will rely more on matching the picture itself.
                </p>
              )}

              <label className="block mt-7">
                <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>Title (optional)</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  className="mt-2 w-full rounded-lg px-4 py-3 text-base bg-transparent border"
                  style={{ borderColor: 'var(--rule)' }}
                />
              </label>

              <button
                onClick={() => void register(phase.file, phase.preview)}
                className="grain-btn mt-7 w-full rounded-full px-6 py-4 text-base font-medium"
              >
                Register with Face ID
              </button>
            </div>
          )}

          {phase.kind === 'working' && (
            <div className="grain-rise text-center">
              <img src={phase.preview} alt="" className="w-full rounded-lg border opacity-60"
                   style={{ borderColor: 'var(--rule)' }} />
              <p className="grain-pulse mt-8 text-lg">{phase.message}</p>
            </div>
          )}

          {phase.kind === 'done' && (
            <div className="grain-rise text-center">
              <h2 style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl">Registered</h2>
              <img src={phase.preview} alt="" className="mt-7 w-full rounded-lg border"
                   style={{ borderColor: 'var(--rule)' }} />
              <div className="mt-7 rounded-lg px-5 py-4 text-left" style={{ background: 'var(--brand-soft)' }}>
                <p className="font-medium">Use this copy from now on</p>
                <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                  We downloaded <span className="font-mono text-[13px]">{phase.filename}</span> — it&rsquo;s
                  the one that carries the mark. The original doesn&rsquo;t.
                </p>
              </div>
              <a href={`/r/${phase.recordId}`} className="grain-btn inline-block mt-7 px-6 py-3 rounded-full text-base font-medium">
                See your record
              </a>
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="grain-rise text-center">
              <p className="text-lg leading-relaxed">{phase.message}</p>
              <button onClick={() => setPhase({ kind: 'choosing' })}
                      className="mt-6 text-sm underline underline-offset-4" style={{ color: 'var(--ink-faint)' }}>
                start over
              </button>
            </div>
          )}

          <input ref={fileInput} type="file" accept={ACCEPTED.join(',')} className="sr-only"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f); e.target.value = ''; }} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
