'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { createWalletClient, createPublicClient, http, bytesToHex, parseEther, type Hex } from 'viem';
import { zipSync } from 'fflate';
import {
  decodeImage, fingerprint, buildManifest, signManifestWith, encodeSignedManifest, encodePNG,
  aspectRatioWarning,
} from '@grain/core';
import { Header, Footer } from '../components/Chrome';
import { unlock, deviceKeyring, PasskeyUnavailable, storedCredential, type Keyring, type Session } from '../lib/mera';
import { knownPenNames, rememberPenName, findPenSlot } from '../lib/pen-names';
import { checkPasskeySupport, hasBuiltInAuthenticator, prfAdvice } from '../lib/passkey-support';
import { monadTestnet, CONTRACTS, registryAbi, creatorAbi } from '../lib/chain';
import { handleOf, toHandle, availableHandle } from '../lib/creators';
import { encodeWatermark, canWatermark, prefetch } from '../lib/trustmark';
import { Share } from '../components/Share';
import { nextRecordId } from '../lib/resolve-client';

/**
 * Register an image.
 *
 * The entire flow is: choose image -> one biometric prompt -> done. Anything
 * else added here is a mistake.
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

/**
 * Up to ten at once: creators have portfolios, not single images. One passkey
 * prompt covers the batch. The cap keeps a batch inside a few minutes and a
 * couple of faucet grants.
 */
const MAX_BATCH = 10;

interface Item { file: File; preview: string; wideRatio: boolean }
type ItemStatus = 'waiting' | 'working' | 'done' | 'failed';
interface Progress { item: Item; status: ItemStatus; recordId?: string }

type Phase =
  | { kind: 'choosing' }
  | { kind: 'ready'; items: Item[] }
  | { kind: 'working'; message: string; progress: Progress[] }
  | { kind: 'done'; progress: Progress[]; filename: string; handle?: string }
  | { kind: 'error'; message: string; preview?: string }
  | { kind: 'passkey-blocked'; headline: string; steps: string[]; items: Item[] };

export default function Register() {
  const [phase, setPhase] = useState<Phase>({ kind: 'choosing' });
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  // Optional, in MON. Per creator, not per image: that is how the contract stores it.
  const [price, setPrice] = useState('');
  // Publish under the creator's own name, or a pen name: a separate account
  // from the same passkey, unlinkable to the first on chain.
  const [persona, setPersona] = useState<'main' | 'pen'>('main');
  const [penInput, setPenInput] = useState('');
  const [pens, setPens] = useState<{ n: number; handle: string }[]>([]);
  useEffect(() => { setPens(knownPenNames()); }, []);
  // Readable only with this passkey; signed into the manifest as ciphertext.
  const [note, setNote] = useState('');
  // Asked once. A returning creator already has a name on chain, and the app
  // knows which visit this is without asking.
  const [firstVisit, setFirstVisit] = useState(true);
  useEffect(() => { setFirstVisit(!storedCredential()); }, []);
  const [buttonLabel, setButtonLabel] = useState('Register with your passkey');

  // The encoder is 17 MB; fetch it while the person is still choosing.
  useEffect(() => { prefetch('register'); }, []);

  /*
   * Name the prompt the person is about to see. Promising
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

  const choose = useCallback(async (picked: File[]) => {
    const files = picked.filter((f) => ACCEPTED.includes(f.type));
    if (files.length === 0) {
      setPhase({ kind: 'error', message: "That file isn't an image Grain can read. Try a PNG or a JPEG." });
      return;
    }
    const items: Item[] = [];
    for (const file of files.slice(0, MAX_BATCH)) {
      let wideRatio = false;
      try {
        const img = decodeImage(new Uint8Array(await file.arrayBuffer()));
        wideRatio = aspectRatioWarning(img.width, img.height);
      } catch { /* the preview still works; registering will decode it again */ }
      items.push({ file, preview: URL.createObjectURL(file), wideRatio });
    }
    setPhase({ kind: 'ready', items });
  }, []);

  const register = useCallback(async (items: Item[], useDeviceKey = false) => {
    const preview = items[0].preview;
    const progress: Progress[] = items.map((item) => ({ item, status: 'waiting' }));
    const step = (message: string) => setPhase({ kind: 'working', message, progress: [...progress] });

    let ring: Keyring;
    if (useDeviceKey) {
      try {
        step('Setting up a key in this browser');
        ring = await deviceKeyring();
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
      // The only authentication step in the product, once for the whole batch.
      // No seed phrase, no wallet connection, no network prompt.
      ring = await unlock(title || undefined);
    } catch (e) {
      if (e instanceof PasskeyUnavailable && e.code === 'PRF_UNAVAILABLE') {
        // Not a dead end: on desktop Chrome the passkey is fine, it is where
        // Chrome saved it that breaks PRF, and that is fixable in place.
        const advice = prfAdvice();
        setPhase({ kind: 'passkey-blocked', ...advice, items });
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

    // One prompt unlocked every key. Choose which account publishes.
    let session: Session = ring.identity;
    const penHandle = persona === 'pen' ? toHandle(penInput) : '';
    let penSlot: number | null = null;
    if (penHandle) {
      step('Finding your pen name');
      penSlot = await findPenSlot(ring, penHandle);
      session = ring.penName(penSlot);
    }

    // A passkey-derived account starts empty and the person has no way to
    // fund it. See app/api/fund for why this exists rather than a relayer. It
    // tops up only what is missing, so calling it before each image of a batch
    // costs nothing while the balance is healthy.
    const fund = () => fetch('/api/fund', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: session.account.address }),
    }).catch(() => undefined);

    const wallet = createWalletClient({
      account: session.account,
      chain: monadTestnet,
      transport: http(process.env.NEXT_PUBLIC_RPC_URL),
    });
    const reader = createPublicClient({ chain: monadTestnet, transport: http(process.env.NEXT_PUBLIC_RPC_URL) });
    const marked: Record<string, Uint8Array> = {};
    let handle: string | undefined;

    try {
      step('Setting up your account');
      await fund();

      // The creator's name, once per creator. Non-fatal: a record without a
      // name is still a record, and a taken handle must not cost someone their
      // registration.
      handle = await handleOf(session.account.address);
      const wanted = penHandle || (name.trim() ? toHandle(name) : null);
      const priceWei = licencePriceWei(price);
      if (!handle && wanted) {
        try {
          step(penHandle ? 'Saving your pen name' : 'Saving your name');
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

      if (penHandle && penSlot !== null && handle) rememberPenName(penSlot, handle);
      const sealedNote = note.trim() && items.length === 1 ? await ring.sealNote(note.trim()) : undefined;

      const batch = items.length > 1;
      for (const [i, p] of progress.entries()) {
        const of = batch ? ` (${i + 1} of ${items.length})` : '';
        p.status = 'working';
        try {
          if (i > 0) await fund();

          step(`Adding the invisible mark${of}`);
          // Done here, in the browser: the image never leaves the device. The id
          // is read first because the watermark carries it; register() takes it
          // as expectedRecordId and reverts if another registration landed
          // first, rather than binding this mark to someone else's record.
          const original = decodeImage(new Uint8Array(await p.item.file.arrayBuffer()));
          const recordId = await nextRecordId();
          const watermarked = canWatermark(original);
          const markedImage = watermarked ? await encodeWatermark(original, recordId) : original;

          step(`Fingerprinting${of}`);
          // The fingerprint of the MARKED image, since that is the copy people
          // will publish and the one the anti-spoof check compares against.
          const fp = fingerprint(markedImage);

          step(`Signing${of}`);
          const manifest = await signManifestWith(
            buildManifest({
              recordId,
              creator: session.account.address as Hex,
              fingerprint: fp,
              // One title can't describe ten images; a batch goes untitled.
              title: batch ? undefined : title || undefined,
              generator: 'Grain Web 0.1.0',
              // Images past 2:1 are registered by fingerprint alone, and the
              // manifest says so rather than claiming a mark that is not there.
              watermarked,
              // Ciphertext only: the note never leaves this browser readable.
              private: sealedNote,
            }),
            session.account,
          );

          step(`Recording it${of}`);
          const hash = await afterFunding(() => wallet.writeContract({
            address: CONTRACTS.GrainRegistry,
            abi: registryAbi,
            functionName: 'register',
            args: [recordId, fp, bytesToHex(encodeSignedManifest(manifest))],
          }));
          // Confirmed, not just sent. register() reverts if another
          // registration took this recordId first, and reporting that as
          // success would hand the person a watermark pointing at someone
          // else's record.
          const receipt = await reader.waitForTransactionReceipt({ hash });
          if (receipt.status !== 'success') throw new Error('registration reverted');

          marked[uniqueName(marked, p.item.file.name.replace(/(\.\w+)?$/, '-grain.png'))] = encodePNG(markedImage);
          p.status = 'done';
          p.recordId = recordId.toString();
        } catch (e) {
          // One image failing must not cost the rest of the batch.
          console.error(e);
          p.status = 'failed';
          if (!batch) throw e;
        }
      }

      const names = Object.keys(marked);
      if (names.length === 0) throw new Error('nothing registered');

      // THE WATERMARKED FILES DOWNLOAD AUTOMATICALLY. Getting this wrong means
      // people publish the unmarked originals and the product silently does
      // not work for them. A batch is one zip: browsers block a burst of
      // separate downloads.
      const filename = names.length === 1 ? names[0] : 'grain-marked-images.zip';
      const bytes = names.length === 1 ? marked[names[0]] : zipSync(marked, { level: 0 });
      const type = names.length === 1 ? 'image/png' : 'application/zip';
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);

      setPhase({ kind: 'done', progress: [...progress], filename, handle });
    } catch (e) {
      console.error(e);
      setPhase({
        kind: 'error',
        message: items.length > 1
          ? 'Something went wrong recording your images. They are safe — try again.'
          : 'Something went wrong recording your image. Your image is safe — try again.',
        preview,
      });
    } finally {
      ring.end();
    }
  }, [title, name, price, persona, penInput, note]);

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
                <span className="text-sm" style={{ color: 'var(--ink-faint)' }}>or up to {MAX_BATCH} at once</span>
              </button>
            </div>
          )}

          {phase.kind === 'ready' && (
            <div className="grain-rise">
              {phase.items.length === 1 ? (
                <img src={phase.items[0].preview} alt={title || 'Image to register'}
                     className="w-full rounded-lg border" style={{ borderColor: 'var(--rule)' }} />
              ) : (
                <>
                  <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
                    {phase.items.length} images, registered together with one passkey prompt
                  </p>
                  <Thumbs progress={phase.items.map((item) => ({ item, status: 'waiting' }))}
                          onRemove={(i) => setPhase({ kind: 'ready', items: phase.items.filter((_, j) => j !== i) })} />
                </>
              )}

              {phase.items.some((it) => it.wideRatio) && (
                <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                  {phase.items.length === 1 ? 'This image is' : 'Some of these images are'} very wide. The invisible
                  mark works less well on shapes like this, so Grain will rely more on matching the picture itself.
                </p>
              )}

              {firstVisit && persona === 'main' && (
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

              <fieldset className="mt-7">
                <legend className="text-sm" style={{ color: 'var(--ink-muted)' }}>Publish as</legend>
                <div className="mt-2 inline-flex rounded-full border p-1" style={{ borderColor: 'var(--rule)' }}>
                  {(['main', 'pen'] as const).map((p) => (
                    <button key={p} type="button" onClick={() => setPersona(p)}
                            className="rounded-full px-4 py-1.5 text-sm transition-colors"
                            style={persona === p ? { background: 'var(--brand)', color: 'var(--paper)' } : { color: 'var(--ink-muted)' }}>
                      {p === 'main' ? 'Under your name' : 'Under a pen name'}
                    </button>
                  ))}
                </div>
                {persona === 'pen' && (
                  <div className="mt-3">
                    {pens.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {pens.map((p) => (
                          <button key={p.n} type="button" onClick={() => setPenInput(p.handle)}
                                  className="rounded-full border px-3 py-1 text-sm"
                                  style={{ borderColor: toHandle(penInput) === p.handle ? 'var(--brand)' : 'var(--rule)' }}>
                            @{p.handle}
                          </button>
                        ))}
                      </div>
                    )}
                    <input value={penInput} onChange={(e) => setPenInput(e.target.value)} maxLength={60}
                           placeholder="e.g. Night Shift Studio"
                           className="w-full rounded-lg px-4 py-3 text-base bg-transparent border" style={{ borderColor: 'var(--rule)' }} />
                    <span className="mt-2 block text-sm" style={{ color: 'var(--ink-faint)' }}>
                      {toHandle(penInput) ? <>Credited as <span style={{ color: 'var(--ink)' }}>@{toHandle(penInput)}</span>. </> : null}
                      A separate account from the same passkey. Nobody can link it to your name on chain; only you can.
                    </span>
                  </div>
                )}
              </fieldset>

              {phase.items.length === 1 && (
                <details className="mt-7 group" open={note !== ''}>
                  <summary className="cursor-pointer text-sm select-none" style={{ color: 'var(--ink-muted)' }}>
                    Add a private note (optional)
                  </summary>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3}
                            placeholder="Where and how you made it, the client, the original file name…"
                            className="mt-3 w-full rounded-lg px-4 py-3 text-base bg-transparent border" style={{ borderColor: 'var(--rule)' }} />
                  <span className="mt-2 block text-sm" style={{ color: 'var(--ink-faint)' }}>
                    Encrypted with your passkey before it leaves this device. It travels with the record, and only you can read it, on any device.
                  </span>
                </details>
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

              {phase.items.length === 1 && (
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
              )}

              <button
                onClick={() => void register(phase.items)}
                className="grain-btn mt-7 w-full rounded-full px-6 py-4 text-base font-medium"
              >
                {phase.items.length === 1 ? buttonLabel : buttonLabel.replace('Register', `Register ${phase.items.length} images`)}
              </button>
              {phase.items.length < MAX_BATCH && (
                <button onClick={() => fileInput.current?.click()}
                        className="mt-4 w-full text-sm underline underline-offset-4" style={{ color: 'var(--ink-faint)' }}>
                  {phase.items.length === 1 ? 'Add more images' : 'Choose different images'}
                </button>
              )}
            </div>
          )}

          {phase.kind === 'working' && (
            <div className="grain-rise text-center">
              {phase.progress.length === 1 ? (
                <img src={phase.progress[0].item.preview} alt="" className="w-full rounded-lg border opacity-60"
                     style={{ borderColor: 'var(--rule)' }} />
              ) : (
                <Thumbs progress={phase.progress} />
              )}
              <p className="grain-pulse mt-8 text-lg">{phase.message}</p>
            </div>
          )}

          {phase.kind === 'done' && phase.progress.length > 1 && (
            <BatchDone progress={phase.progress} filename={phase.filename} handle={phase.handle} />
          )}

          {phase.kind === 'done' && phase.progress.length === 1 && (
            <div className="grain-rise text-center">
              <h2 style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl">Registered</h2>
              {phase.handle && (
                <p className="mt-2 text-base" style={{ color: 'var(--ink-muted)' }}>
                  as <span style={{ color: 'var(--ink)' }}>@{phase.handle}</span>
                </p>
              )}
              <img src={phase.progress[0].item.preview} alt="" className="mt-7 w-full rounded-lg border"
                   style={{ borderColor: 'var(--rule)' }} />
              <div className="mt-7 rounded-lg px-5 py-4 text-left" style={{ background: 'var(--brand-soft)' }}>
                <p className="font-medium">Use this copy from now on</p>
                <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                  We downloaded <span className="font-mono text-[13px]">{phase.filename}</span> — it&rsquo;s
                  the one that carries the mark. The original doesn&rsquo;t.
                </p>
              </div>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <a href={`/r/${phase.progress[0].recordId}`} className="grain-btn inline-block px-6 py-3 rounded-full text-base font-medium">
                  See your record
                </a>
                <Share path={`/r/${phase.progress[0].recordId}`} label="Share it"
                       text="I just registered my work on Grain. Anyone can check who made it, even from a screenshot:" />
              </div>
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
                  onClick={() => void register(phase.items, true)}
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

          <input ref={fileInput} type="file" accept={ACCEPTED.join(',')} multiple className="sr-only"
                 onChange={(e) => {
                   const picked = [...(e.target.files ?? [])];
                   // "Add more" keeps what was already chosen.
                   const kept = phase.kind === 'ready' && phase.items.length === 1 ? [phase.items[0].file] : [];
                   if (picked.length) void choose([...kept, ...picked]);
                   e.target.value = '';
                 }} />
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
 * through two seconds later, and a pen name's first transaction once failed
 * for several seconds. The RPC reports it as "insufficient balance" or only as
 * "Missing or invalid parameters". Retry those, for up to ~16 s; anything else
 * is a real failure and surfaces at once.
 */
async function afterFunding<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send();
    } catch (e) {
      const text = `${(e as { details?: string }).details ?? ''} ${(e as Error).message ?? ''}`;
      if (attempt >= 8 || !/insufficient balance|missing or invalid parameters/i.test(text)) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** "a-grain.png" twice in one batch would overwrite in the zip. */
function uniqueName(taken: Record<string, unknown>, name: string): string {
  if (!(name in taken)) return name;
  for (let n = 2; ; n++) {
    const candidate = name.replace(/\.png$/, `-${n}.png`);
    if (!(candidate in taken)) return candidate;
  }
}

const STATUS_LABEL: Record<ItemStatus, string> = { waiting: 'Waiting', working: 'Working', done: 'Registered', failed: 'Failed' };

/** A batch, as a grid: each image with where it has got to. */
function Thumbs({ progress, onRemove }: { progress: Progress[]; onRemove?: (i: number) => void }) {
  return (
    <ul className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
      {progress.map((p, i) => (
        <li key={p.item.preview} className="relative aspect-square overflow-hidden rounded-md border"
            style={{ borderColor: p.status === 'failed' ? 'var(--accent)' : 'var(--rule)' }}>
          <img src={p.item.preview} alt="" className="h-full w-full object-cover"
               style={{ opacity: p.status === 'waiting' && !onRemove ? 0.45 : 1 }} />
          {!onRemove && (
            <span className={`absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[11px] ${p.status === 'working' ? 'grain-pulse' : ''}`}
                  style={{
                    background: p.status === 'done' ? 'var(--brand)' : p.status === 'failed' ? 'var(--accent)' : 'var(--surface)',
                    color: p.status === 'done' || p.status === 'failed' ? 'var(--paper)' : 'var(--ink)',
                  }}>
              {STATUS_LABEL[p.status]}
            </span>
          )}
          {onRemove && (
            <button onClick={() => onRemove(i)} aria-label="Remove this image"
                    className="absolute right-1 top-1 h-6 w-6 rounded-full text-sm leading-6"
                    style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
              &times;
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function BatchDone({ progress, filename, handle }: { progress: Progress[]; filename: string; handle?: string }) {
  const done = progress.filter((p) => p.status === 'done');
  const failed = progress.length - done.length;
  return (
    <div className="grain-rise text-center">
      <h2 style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl">
        {failed ? `Registered ${done.length} of ${progress.length}` : `Registered ${done.length} images`}
      </h2>
      {handle && (
        <p className="mt-2 text-base" style={{ color: 'var(--ink-muted)' }}>
          as <span style={{ color: 'var(--ink)' }}>@{handle}</span>
        </p>
      )}
      <ul className="mt-7 grid grid-cols-3 sm:grid-cols-4 gap-2 text-left">
        {progress.map((p) => (
          <li key={p.item.preview}>
            {p.recordId ? (
              <a href={`/r/${p.recordId}`} className="block overflow-hidden rounded-md border" style={{ borderColor: 'var(--rule)' }}>
                <img src={p.item.preview} alt="" className="aspect-square w-full object-cover" />
                <span className="block px-2 py-1 text-[12px]">Record #{p.recordId}</span>
              </a>
            ) : (
              <div className="overflow-hidden rounded-md border" style={{ borderColor: 'var(--accent)' }}>
                <img src={p.item.preview} alt="" className="aspect-square w-full object-cover opacity-50" />
                <span className="block px-2 py-1 text-[12px]" style={{ color: 'var(--accent)' }}>Not registered</span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {failed > 0 && (
        <p className="mt-4 text-sm" style={{ color: 'var(--ink-muted)' }}>
          {failed === 1 ? 'One image' : `${failed} images`} didn&rsquo;t go through. Register {failed === 1 ? 'it' : 'them'} again on its own.
        </p>
      )}
      <div className="mt-7 rounded-lg px-5 py-4 text-left" style={{ background: 'var(--brand-soft)' }}>
        <p className="font-medium">Use these copies from now on</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
          We downloaded <span className="font-mono text-[13px]">{filename}</span> — the copies inside carry the
          mark. The originals don&rsquo;t.
        </p>
      </div>
      {handle && (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <a href={`/c/${handle}`} className="grain-btn inline-block px-6 py-3 rounded-full text-base font-medium">
            See all your work
          </a>
          <Share path={`/c/${handle}`} label="Share it"
                 text="I just registered my work on Grain. Anyone can check who made it, even from a screenshot:" />
        </div>
      )}
    </div>
  );
}
