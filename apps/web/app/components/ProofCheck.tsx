'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPublicClient, http, type PublicClient } from 'viem';
import { CONTRACTS, monadTestnet } from '../lib/chain';
import { checkProof, parseProof, type ProofCheck as Result } from '../lib/pen-proof';

// The visitor's browser asks Monad directly: the proof must not depend on Grain's servers.
const chain = createPublicClient({ chain: monadTestnet, transport: http(process.env.NEXT_PUBLIC_RPC_URL) }) as PublicClient;
const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ProofCheck() {
  const params = useSearchParams();
  const [result, setResult] = useState<Result | 'checking' | 'malformed'>('checking');

  useEffect(() => {
    const proof = parseProof(params);
    if (!proof) { setResult('malformed'); return; }
    checkProof(chain, proof).then(setResult).catch(() => setResult({ ok: false, reason: "Couldn't reach Monad just now. Try again in a moment." }));
  }, [params]);

  if (result === 'checking') return <p className="grain-pulse mt-6 text-lg" style={{ color: 'var(--ink-muted)' }}>Checking against Monad&hellip;</p>;
  if (result === 'malformed') return <h1 style={{ fontFamily: 'var(--serif)' }} className="mt-2 text-4xl">This link isn&rsquo;t a complete proof.</h1>;
  if (!result.ok) {
    return (
      <>
        <h1 style={{ fontFamily: 'var(--serif)', color: 'var(--accent)' }} className="mt-2 text-4xl sm:text-5xl leading-tight">Not proven.</h1>
        <p className="mt-4 text-lg" style={{ color: 'var(--ink-muted)' }}>{result.reason}</p>
      </>
    );
  }
  const who = result.identityHandle ? `@${result.identityHandle}` : `${result.identity.slice(0, 6)}…${result.identity.slice(-4)}`;
  return (
    <>
      <h1 style={{ fontFamily: 'var(--serif)' }} className="mt-2 text-4xl sm:text-5xl leading-tight">
        <Link href={`/c/${result.penHandle}`} className="underline decoration-1 underline-offset-[6px]" style={{ textDecorationColor: 'var(--rule)' }}>@{result.penHandle}</Link>
        {' '}is{' '}
        {result.identityHandle
          ? <Link href={`/c/${result.identityHandle}`} className="underline decoration-1 underline-offset-[6px]" style={{ textDecorationColor: 'var(--rule)' }}>{who}</Link>
          : who}
      </h1>
      <ul className="mt-6 space-y-2 text-[15px]">
        <li><span style={{ color: 'var(--brand)' }}>&#10003;</span> The commitment @{result.penHandle} recorded on Monad matches this proof</li>
        <li><span style={{ color: 'var(--brand)' }}>&#10003;</span> Signed by {who}&rsquo;s identity, {when(result.issuedAt)}</li>
        <li style={{ color: 'var(--ink-muted)' }}>&middot; Checked just now, in your browser, against{' '}
          <a href={`https://testnet.monadscan.com/address/${CONTRACTS.CreatorRegistry}`} target="_blank" rel="noreferrer" className="underline underline-offset-4">CreatorRegistry</a></li>
      </ul>
    </>
  );
}
