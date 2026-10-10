'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPublicClient, http, type Hex } from 'viem';
import { anchorAbi, CONTRACTS, monadTestnet } from '../lib/chain';
import { sealTransactions } from '../lib/indexer';
import { logRoot } from '../lib/seal-format';

interface Seal { index: number; from: number; until: number; events: number; root: Hex; txHash?: string; sealedAt?: number }
type Check = { state: 'checking' } | { state: 'match'; lines: number } | { state: 'mismatch'; lines: number } | { state: 'error'; message: string };

const SHOW = 30;
const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// The browser reads the seals itself: trusting Grain's server for them would
// defeat the point of checking.
const chain = createPublicClient({ chain: monadTestnet, transport: http(process.env.NEXT_PUBLIC_RPC_URL) });

async function check(seal: Seal): Promise<Check> {
  try {
    const res = await fetch(`/api/activity-log?from=${seal.from}&until=${seal.until}`, { cache: 'no-store' });
    if (!res.ok) return { state: 'error', message: 'The log could not be downloaded just now.' };
    const { lines } = (await res.json()) as { lines: string[] };
    const ok = logRoot(lines) === seal.root && lines.length === seal.events;
    return { state: ok ? 'match' : 'mismatch', lines: lines.length };
  } catch {
    return { state: 'error', message: 'The log could not be downloaded just now.' };
  }
}

export function SealedHistory() {
  const [seals, setSeals] = useState<Seal[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [checks, setChecks] = useState<Record<number, Check>>({});

  useEffect(() => {
    void (async () => {
      try {
        const count = Number(await chain.readContract({ address: CONTRACTS.ActivityAnchor, abi: anchorAbi, functionName: 'sealCount' }));
        const ids = Array.from({ length: Math.min(SHOW, count) }, (_, i) => count - 1 - i);
        const rows = await Promise.all(ids.map((i) =>
          chain.readContract({ address: CONTRACTS.ActivityAnchor, abi: anchorAbi, functionName: 'seals', args: [BigInt(i)] })));
        // Each seal's transaction comes from Envio; the roots stay the chain's.
        // A row whose indexed root disagrees with the chain gets no link.
        const txs = await sealTransactions();
        setSeals(rows.map((s, k) => {
          const tx = txs?.get(ids[k]);
          const ours = tx && tx.root.toLowerCase() === s.root.toLowerCase() ? tx : undefined;
          return { index: ids[k], from: Number(s.from), until: Number(s.until), events: s.events, root: s.root, txHash: ours?.txHash, sealedAt: ours?.sealedAt };
        }));
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  const run = useCallback(async (s: Seal) => {
    setChecks((c) => ({ ...c, [s.index]: { state: 'checking' } }));
    const result = await check(s);
    setChecks((c) => ({ ...c, [s.index]: result }));
    return result;
  }, []);

  const runAll = useCallback(async () => {
    for (const s of seals ?? []) await run(s);
  }, [seals, run]);

  if (failed) return <p className="mt-10" style={{ color: 'var(--ink-muted)' }}>Couldn&rsquo;t read the seals from Monad just now. Try again in a moment.</p>;
  if (!seals) return <p className="grain-pulse mt-10" style={{ color: 'var(--ink-muted)' }}>Reading the seals from Monad&hellip;</p>;

  const done = seals.filter((s) => checks[s.index]?.state === 'match').length;
  const total = seals.reduce((n, s) => n + s.events, 0);

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          <strong style={{ color: 'var(--ink)' }}>{seals.length}</strong> {seals.length === 1 ? 'seal' : 'seals'}
          {' '}&middot; <strong style={{ color: 'var(--ink)' }}>{total}</strong> {total === 1 ? 'event' : 'events'}
          {seals[0] && <> &middot; sealed up to {when(seals[0].until)}</>}
        </p>
        <button onClick={() => void runAll()} className="grain-btn rounded-full px-5 py-2 text-sm font-medium">
          {done === seals.length && done > 0 ? `All ${done} match` : 'Check all'}
        </button>
      </div>
      <ul className="mt-4 divide-y rounded-lg border" style={{ borderColor: 'var(--rule)' }}>
        {seals.map((s) => {
          const c = checks[s.index];
          return (
            <li key={s.index} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderColor: 'var(--rule)' }}>
              <div className="min-w-0">
                <p className="text-[14px]">
                  {s.index === 0 ? 'Start of the log' : <>{when(s.from)} &rarr; {when(s.until)}</>}
                  <span style={{ color: 'var(--ink-muted)' }}> &middot; {s.events} {s.events === 1 ? 'event' : 'events'}</span>
                </p>
                <p className="mt-0.5 font-mono text-[11px] truncate" style={{ color: 'var(--ink-faint)' }}>{s.root}</p>
                {s.txHash && (
                  <p className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                    Sealed {when(s.sealedAt!)} &middot;{' '}
                    <a href={`https://testnet.monadscan.com/tx/${s.txHash}`} target="_blank" rel="noreferrer" className="underline">see the transaction</a>
                  </p>
                )}
              </div>
              <div className="shrink-0 text-sm">
                {!c && <button onClick={() => void run(s)} className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--rule)' }}>Check</button>}
                {c?.state === 'checking' && <span className="grain-pulse" style={{ color: 'var(--ink-muted)' }}>Checking&hellip;</span>}
                {c?.state === 'match' && <span style={{ color: 'var(--brand)' }}>&#10003; Matches the seal</span>}
                {c?.state === 'mismatch' && <span style={{ color: 'var(--accent)' }}>&#10005; Doesn&rsquo;t match: the log was changed</span>}
                {c?.state === 'error' && <span style={{ color: 'var(--ink-muted)' }}>{c.message}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
