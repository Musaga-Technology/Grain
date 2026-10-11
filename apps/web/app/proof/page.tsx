import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Header, Footer } from '../components/Chrome';
import { ProofCheck } from '../components/ProofCheck';

export const metadata: Metadata = {
  title: 'Pen-name proof · Grain',
  description: 'Check, against Monad, that a pen name belongs to the creator who shared this proof.',
};

export default function Proof() {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-2xl px-5 py-14 sm:py-20">
        <p className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink-faint)' }}>Pen-name proof</p>
        <Suspense fallback={null}><ProofCheck /></Suspense>
        <div className="mt-12 rounded-lg px-5 py-4 text-[14px] leading-relaxed" style={{ background: 'var(--brand-soft)', color: 'var(--ink-muted)' }}>
          <p className="font-medium" style={{ color: 'var(--ink)' }}>How this works</p>
          <p className="mt-1">
            On Grain, a pen name is its own account, derived from the creator&rsquo;s passkey and unlinkable on chain to
            their identity. When the pen name was set up, it recorded a commitment on Monad: a hash that means nothing
            without a secret only the creator&rsquo;s passkey can produce. This link carries that secret for this one
            pen name, signed by the creator&rsquo;s identity.
          </p>
          <p className="mt-2">
            Your browser reads the commitment from Monad, recomputes it from the link, and checks the signature. Nothing
            is taken on trust, not even from Grain. The creator&rsquo;s other pen names stay unlinkable: each has its own
            secret.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
