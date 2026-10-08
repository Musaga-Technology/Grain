'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { createWalletClient, createPublicClient, http, bytesToHex, parseEther, type Hex } from 'viem';
import {
  decodeImage, fingerprint, buildManifest, signManifestWith, encodeSignedManifest, encodePNG,
  aspectRatioWarning,
} from '@grain/core';
import { Header, Footer } from '../components/Chrome';
import { identitySession, deviceSession, PasskeyUnavailable, storedCredential, type Session } from '../lib/mera';
import { checkPasskeySupport, hasBuiltInAuthenticator, prfAdvice } from '../lib/passkey-support';
import { monadTestnet, CONTRACTS, registryAbi, creatorAbi } from '../lib/chain';
import { handleOf, toHandle, availableHandle } from '../lib/creators';
import { encodeWatermark, canWatermark, prefetch } from '../lib/trustmark';
import { nextRecordId } from '../lib/resolve-client';

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

/** PNG and JPEG: grain-core owns both decoders, so the fingerprint is the same everywhere. */
const ACCEPTED = ['image/png', 'image/jpeg'];

type Phase =
  | { kind: 'choosing' }
  | { kind: 'ready'; file: File; preview: string; wideRatio: boolean }
  | { kind: 'working'; message: string; preview: string }
  | { kind: 'done'; recordId: string; preview: string; filename: string; handle?: string }
  | { kind: 'error'; message: string; preview?: string }
  | { kind: 'passkey-blocked'; headline: string; steps: string[]; preview: string; file: File };

export default function Register() {
  const [phase, setPhase] = useState<Phase>({ kind: 'choosing' });
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  // Optional, in MON. Per creator, not per image: that is how the contract stores it.
  const [price, setPrice] = useState('');
  // Asked once. A returning creator already has a name on chain, and the app
  // knows which visit this is without asking (UX_SPEC /register).
  const [firstVisit, setFirstVisit] = useState(true);
  useEffect(() => { setFirstVisit(!storedCredential()); }, []);
  const [buttonLabel, setButtonLabel] = useState('Register with your passkey');

  // The encoder is 17 MB; fetch it while the person is still choosing.
  useEffect(() => { prefetch('register'); }, []);

  /*
   * Name the prompt the person is about to see (UX_SPEC /register). Promising
   * Face ID on a machine without it is a small lie that makes the real prompt
   * -- a QR code, a password manager -- look like something went wrong.
   */
  useEffect(() => {
    void hasBuiltInAuthenticator().then((builtIn) => {
      if (!builtIn) return; // keep the generic label
      const ua = navigator.userAgent;
      if (/iPhone|iPad/.test(ua)) setButtonLabel('Register with Face ID');
      else if (/Mac/.test(ua)) setButtonLabel('Register with Touch ID');
      else if (/Windows/.test(ua)) setButtonLabel('Register with Windows Hello');
      else if (/Android/.test(ua)) setButtonLabel('Register with your fingerprint');
    });
  }, []);
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

  const register = useCallback(async (file: File, preview: string, useDeviceKey = false) => {
    const step = (message: string) => setPhase({ kind: 'working', message, preview });

    let session: Session;
    if (useDeviceKey) {
      try {
        step('Setting up a key in this browser');
        session = await deviceSession();
      } catch (e) {
        setPhase({ kind: 'error', message: (e as Error).message, preview });
        return;
      }
    } else {

    // Checked BEFORE the ceremony. Mera creates the passkey first and evaluates
    // PRF second, and a failure after creation strands a credential on the
    // authenticator that nothing can clean up.
    const support = await checkPasskeySupport();
    if (!support.ok) {
      setPhase({ kind: 'error', message: support.message, preview });
      return;
    }

    try {
      step(storedCredential() ? 'Waiting for your passkey' : 'Creating your passkey');
      // The only authentication step in the product. No seed phrase, no wallet
      // connection, no network prompt.
      session = await identitySession(title || undefined);
    } catch (e) {
      if (e instanceof PasskeyUnavailable && e.code === 'PRF_UNAVAILABLE') {
        // Not a dead end: on desktop Chrome the passkey is fine, it is where
        // Chrome saved it that breaks PRF, and that is fixable in place.
        const advice = prfAdvice();
        setPhase({ kind: 'passkey-blocked', ...advice, preview, file });
        return;
      }
      setPhase({
        kind: 'error',
        message: e instanceof PasskeyUnavailable ? e.message : "Grain couldn't use your passkey just now. Try again.",
        preview,
      });
      return;
    }
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
      // Done here, in the browser: the image never leaves the device. The id is
      // read first because the watermark carries it; register() takes it as
      // expectedRecordId and reverts if another registration landed first,
      // rather than binding this mark to someone else's record.
      const original = decodeImage(new Uint8Array(await file.arrayBuffer()));
      const recordId = await nextRecordId();
      const watermarked = canWatermark(original);
      const markedImage = watermarked ? await encodeWatermark(original, recordId) : original;
      const markedBytes = encodePNG(markedImage);

      step('Fingerprinting your image');
      // The fingerprint of the MARKED image, since that is the copy people will
      // publish and the one the anti-spoof check compares against.
      const fp = fingerprint(markedImage);

      step('Signing');
      const manifest = await signManifestWith(
        buildManifest({
          recordId,
          creator: session.account.address as Hex,
          fingerprint: fp,
          title: title || undefined,
          generator: 'Grain Web 0.1.0',
          // Images past 2:1 are registered by fingerprint alone, and the
          // manifest says so rather than claiming a mark that is not there.
          watermarked,
        }),
        session.account,
      );

      const wallet = createWalletClient({
        account: session.account,
        chain: monadTestnet,
        transport: http(process.env.NEXT_PUBLIC_RPC_URL),
      });
      const reader = createPublicClient({ chain: monadTestnet, transport: http(process.env.NEXT_PUBLIC_RPC_URL) });

      // The creator's name, once. Non-fatal: a record without a name is still a
      // record, and a taken handle must not cost someone their registration.
      let handle = await handleOf(session.account.address);
      const wanted = name.trim() ? toHandle(name) : null;
      const priceWei = licencePriceWei(price);
      if (!handle && wanted) {
        try {
          step('Saving your name');
          const chosen = await availableHandle(wanted, session.account.address);
          const tx = await afterFunding(() => wallet.writeContract({
            address: CONTRACTS.CreatorRegistry, abi: creatorAbi, functionName: 'setProfile',
            args: [chosen, '', priceWei ?? 0n],
          }));
          const receipt = await reader.waitForTransactionReceipt({ hash: tx });
          if (receipt.status === 'success') handle = chosen;
        } catch (e) {
          console.warn('could not save the creator name', e);
        }
      } else if (handle && priceWei !== null) {
        // A returning creator changing their price keeps their name.
        const keep = handle;
        try {
          step('Saving your licence price');
          const tx = await afterFunding(() => wallet.writeContract({
            address: CONTRACTS.CreatorRegistry, abi: creatorAbi, functionName: 'setProfile',
            args: [keep, '', priceWei],
          }));
          await reader.waitForTransactionReceipt({ hash: tx });
        } catch (e) {
          console.warn('could not save the licence price', e);
        }
      }

      step('Recording it');
      const hash = await afterFunding(() => wallet.writeContract({
        address: CONTRACTS.GrainRegistry,
        abi: registryAbi,
        functionName: 'register',
        args: [recordId, fp, bytesToHex(encodeSignedManifest(manifest))],
      }));
      // Confirmed, not just sent. register() reverts if another registration
      // took this recordId first, and reporting that as success would hand the
      // person a watermark pointing at someone else's record.
      const receipt = await reader.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        throw new Error('registration reverted');
      }

      // THE WATERMARKED FILE DOWNLOADS AUTOMATICALLY. Getting this wrong means
      // people publish the unmarked original and the product silently does not
      // work for them.
      const filename = file.name.replace(/(\.\w+)?$/, '-grain.png');
      const url = URL.createObjectURL(new Blob([markedBytes as BlobPart], { type: 'image/png' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);

      setPhase({ kind: 'done', recordId: recordId.toString(), preview, filename, handle });
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
  }, [title, name, price]);

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

              {firstVisit && (
                <label className="block mt-7">
                  <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>Your name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    autoComplete="name"
                    placeholder="Ana Ruiz"
                    className="mt-2 w-full rounded-lg px-4 py-3 text-base bg-transparent border"
                    style={{ borderColor: 'var(--rule)' }}
                  />
                  <span className="mt-2 block text-sm" style={{ color: 'var(--ink-faint)' }}>
                    {toHandle(name)
                      ? <>Anyone who checks your image will see <span style={{ color: 'var(--ink)' }}>Made by @{toHandle(name)}</span></>
                      : 'This is how you’ll be credited when someone checks your image.'}
                  </span>
                </label>
              )}

              <details className="mt-7 group" open={price !== ''}>
                <summary className="cursor-pointer text-sm select-none" style={{ color: 'var(--ink-muted)' }}>
                  Let AI agents license your work (optional)
                </summary>
                <label className="block mt-3">
                  <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>Licence price, in MON</span>
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    inputMode="decimal"
                    placeholder="0.01"
                    className="mt-2 w-full rounded-lg px-4 py-3 text-base bg-transparent border"
                    style={{ borderColor: price && licencePriceWei(price) === null ? 'var(--accent)' : 'var(--rule)' }}
                  />
                  <span className="mt-2 block text-sm" style={{ color: 'var(--ink-faint)' }}>
                    Agents using the MetaMask Agent Wallet can license your images for this amount, paid
                    straight to you, with no fee. It applies to all your images. Leave it empty to stay unlicensable.
                  </span>
                </label>
              </details>

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
                {buttonLabel}
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
              {phase.handle && (
                <p className="mt-2 text-base" style={{ color: 'var(--ink-muted)' }}>
                  as <span style={{ color: 'var(--ink)' }}>@{phase.handle}</span>
                </p>
              )}
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

          {phase.kind === 'passkey-blocked' && (
            <div className="grain-rise">
              <h2 style={{ fontFamily: 'var(--serif)' }} className="text-2xl sm:text-3xl leading-tight">
                {phase.headline}
              </h2>
              <ol className="mt-6 space-y-3">
                {phase.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                    <span className="shrink-0 tabular-nums" style={{ color: 'var(--ink-faint)' }}>
                      {i + 1}.
                    </span>
                    <span style={{ color: 'var(--ink-muted)' }}>{s}</span>
                  </li>
                ))}
              </ol>
              <button
                onClick={() => setPhase({ kind: 'choosing' })}
                className="grain-btn mt-8 px-6 py-3 rounded-full text-base font-medium"
              >
                Try again
              </button>

              {/* Never a dead end. The trade is stated before it is chosen,
                  not discovered after. */}
              <div className="mt-10 pt-8 border-t" style={{ borderColor: 'var(--rule)' }}>
                <p className="font-medium">Or register without a passkey</p>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                  Grain can keep a key in this browser instead. Your image is registered the same way,
                  but the record stays tied to this browser: you won&rsquo;t be able to manage it from
                  another device, and clearing this site&rsquo;s data loses it.
                </p>
                <button
                  onClick={() => void register(phase.file, phase.preview, true)}
                  className="mt-5 text-base underline underline-offset-4"
                >
                  Use this browser instead
                </button>
              </div>
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

/** A positive MON amount as wei, or null for empty or unusable input. */
function licencePriceWei(input: string): bigint | null {
  if (!input.trim()) return null;
  try {
    const wei = parseEther(input.trim());
    return wei > 0n ? wei : null;
  } catch {
    return null;
  }
}

/**
 * Monad validates a new transaction against state a few blocks behind the
 * tip, so for a second or two after the faucet's grant lands, a brand-new
 * account can still look empty and be refused with "insufficient balance".
 * Measured: a licence sent straight after funding failed once, then went
 * through two seconds later. Retry that one error, briefly; anything else is
 * a real failure and surfaces at once.
 */
async function afterFunding<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send();
    } catch (e) {
      const text = `${(e as { details?: string }).details ?? ''} ${(e as Error).message ?? ''}`;
      if (attempt >= 5 || !/insufficient balance/i.test(text)) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
