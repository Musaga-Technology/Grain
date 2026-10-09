'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatEther, type Hex } from 'viem';
import { decodeCbor } from '@grain/core';
import { unlock, deviceKeyring, storedCredential, hasDeviceKey, PasskeyUnavailable, type Keyring } from '../lib/mera';
import { discoverPenNames } from '../lib/pen-names';
import { creatorByAddress, type CreatorPage } from '../lib/indexer';

/**
 * "Your work": one passkey prompt, every key.
 *
 * The prompt yields one PRF output. From it the browser derives the creator's
 * identity, finds each pen name by asking the chain which pen-name accounts
 * have a name, and derives the key that opens private notes. Nothing here was
 * stored anywhere: on a new device, the same passkey recovers all of it.
 */

interface Persona { kind: 'identity' | 'pen'; address: string; handle: string | null; page: CreatorPage | null | 'unavailable' }
type Phase =
  | { kind: 'locked' }
  | { kind: 'unlocking'; message: string }
  | { kind: 'open'; personas: Persona[]; notes: Record<string, string> }
  | { kind: 'error'; message: string };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function notesFor(ring: Keyring, pages: CreatorPage[]): Promise<Record<string, string>> {
  const notes: Record<string, string> = {};
  for (const page of pages) {
    for (const r of page.records) {
      try {
        const m = decodeCbor(new Uint8Array((r.manifest.slice(2).match(/../g) ?? []).map((b) => parseInt(b, 16)))) as { private?: Hex };
        if (m.private) {
          const text = await ring.openNote(m.private);
          if (text !== null) notes[r.recordId] = text;
        }
      } catch { /* not a Grain manifest, or no note */ }
    }
  }
  return notes;
}

export function YourWork() {
  const [phase, setPhase] = useState<Phase>({ kind: 'locked' });
  const [hasPasskey, setHasPasskey] = useState(false);
  const [deviceOnly, setDeviceOnly] = useState(false);
  useEffect(() => { setHasPasskey(Boolean(storedCredential())); setDeviceOnly(!storedCredential() && hasDeviceKey()); }, []);

  const open = useCallback(async (useDevice: boolean) => {
    let ring: Keyring;
    try {
      setPhase({ kind: 'unlocking', message: useDevice ? 'Opening the key in this browser' : 'Waiting for your passkey' });
      ring = useDevice ? await deviceKeyring() : await unlock();
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof PasskeyUnavailable ? e.message : "Grain couldn't use your passkey just now. Try again." });
      return;
    }
    try {
      setPhase({ kind: 'unlocking', message: 'Finding your pen names' });
      const pens = await discoverPenNames(ring);
      setPhase({ kind: 'unlocking', message: 'Reading your records' });
      const personas: Persona[] = await Promise.all([
        { kind: 'identity' as const, address: ring.identity.account.address, handle: null },
        ...pens.map((p) => ({ kind: 'pen' as const, address: p.address, handle: p.handle })),
      ].map(async (p) => ({ ...p, page: await creatorByAddress(p.address) })));
      setPhase({ kind: 'unlocking', message: 'Opening your private notes' });
      const pages = personas.map((p) => p.page).filter((p): p is CreatorPage => Boolean(p) && p !== 'unavailable');
      const notes = await notesFor(ring, pages);
      setPhase({ kind: 'open', personas, notes });
    } catch {
      setPhase({ kind: 'error', message: "Grain couldn't load your work just now. Try again." });
    } finally {
      ring.end();
    }
  }, []);

  if (phase.kind === 'locked' || phase.kind === 'error') {
    return (
      <div className="text-center grain-rise">
        <h1 style={{ fontFamily: 'var(--serif)' }} className="text-4xl sm:text-5xl">Your work</h1>
        <p className="mt-4 text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          One passkey prompt opens everything: your name, every pen name, your earnings, and the private notes
          only you can read. On any device your passkey is on.
        </p>
        {phase.kind === 'error' && <p className="mt-6" style={{ color: 'var(--accent)' }}>{phase.message}</p>}
        <button onClick={() => void open(false)} className="grain-btn mt-9 rounded-full px-6 py-3 text-base font-medium">
          Unlock with your passkey
        </button>
        {deviceOnly && (
          <button onClick={() => void open(true)} className="mt-4 block w-full text-sm underline underline-offset-4" style={{ color: 'var(--ink-faint)' }}>
            Use the key kept in this browser
          </button>
        )}
        {!hasPasskey && !deviceOnly && (
          <p className="mt-6 text-sm" style={{ color: 'var(--ink-faint)' }}>
            Haven&rsquo;t registered yet? <Link href="/register" className="underline underline-offset-4">Register an image</Link> first.
          </p>
        )}
      </div>
    );
  }

  if (phase.kind === 'unlocking') {
    return <p className="grain-pulse text-center text-lg">{phase.message}</p>;
  }

  const { personas, notes } = phase;
  const pens = personas.filter((p) => p.kind === 'pen');
  return (
    <div className="grain-rise">
      <h1 style={{ fontFamily: 'var(--serif)' }} className="text-4xl sm:text-5xl">Your work</h1>

      <section className="mt-8 rounded-lg px-5 py-4" style={{ background: 'var(--brand-soft)' }}>
        <p className="text-sm font-medium">One passkey, one prompt, {2 + pens.length} keys</p>
        <ul className="mt-3 space-y-1.5 text-[14px]" style={{ color: 'var(--ink-muted)' }}>
          <li><span style={{ color: 'var(--ink)' }}>Your identity</span> &middot; <span className="font-mono text-[12px]">{short(personas[0].address)}</span></li>
          {pens.map((p) => (
            <li key={p.address}><span style={{ color: 'var(--ink)' }}>Pen name @{p.handle}</span> &middot; <span className="font-mono text-[12px]">{short(p.address)}</span> &middot; unlinkable on chain</li>
          ))}
          <li><span style={{ color: 'var(--ink)' }}>Private-notes key</span> &middot; opened {Object.keys(notes).length} {Object.keys(notes).length === 1 ? 'note' : 'notes'}</li>
        </ul>
        <p className="mt-3 text-xs" style={{ color: 'var(--ink-faint)' }}>
          Derived in this browser from your passkey and wiped when this page finished loading. Nothing was stored.
        </p>
      </section>

      {personas.map((p) => {
        const page = p.page;
        const title = p.kind === 'identity' ? (page && page !== 'unavailable' && page.handle ? `@${page.handle}` : 'Your identity') : `@${p.handle}`;
        return (
          <section key={p.address} className="mt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 style={{ fontFamily: 'var(--serif)' }} className="text-2xl">
                {title} {p.kind === 'pen' && <span className="text-sm" style={{ fontFamily: 'var(--sans)', color: 'var(--ink-faint)' }}>pen name</span>}
              </h2>
              {page && page !== 'unavailable' && page.handle && (
                <Link href={`/c/${page.handle}`} className="text-sm underline underline-offset-4">Public page &rarr;</Link>
              )}
            </div>
            {page === 'unavailable' && <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>The indexer isn&rsquo;t answering just now.</p>}
            {!page && <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>Nothing registered under this one yet.</p>}
            {page && page !== 'unavailable' && (
              <>
                <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                  {page.recordCount} {page.recordCount === 1 ? 'image' : 'images'}
                  {page.licences.length > 0 && <> &middot; {Number(formatEther(page.licences.reduce((s, l) => s + BigInt(l.amountWei), 0n)))} MON earned from {page.licences.length} {page.licences.length === 1 ? 'licence' : 'licences'}</>}
                </p>
                <ul className="mt-4 divide-y rounded-lg border" style={{ borderColor: 'var(--rule)' }}>
                  {page.records.map((r) => (
                    <li key={r.recordId} className="px-4 py-3" style={{ borderColor: 'var(--rule)' }}>
                      <Link href={`/r/${r.recordId}`} className="text-[15px] underline underline-offset-4">Record #{r.recordId}</Link>
                      {notes[r.recordId] && (
                        <p className="mt-1.5 text-[14px] leading-relaxed">
                          <span className="mr-1.5 rounded px-1.5 py-0.5 text-[11px]" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>private</span>
                          {notes[r.recordId]}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
