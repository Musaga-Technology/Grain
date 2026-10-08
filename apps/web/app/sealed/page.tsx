import type { Metadata } from 'next';
import { Header, Footer } from '../components/Chrome';
import { SealedHistory } from '../components/SealedHistory';
import { CONTRACTS } from '../lib/chain';

export const metadata: Metadata = {
  title: 'Sealed history · Grain',
  description: "Grain's activity log, sealed on Monad. Check that nobody, including Grain, has rewritten it.",
};

export default function Sealed() {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-2xl px-5 py-14 sm:py-20">
        <p className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink-faint)' }}>Sealed history</p>
        <h1 style={{ fontFamily: 'var(--serif)' }} className="mt-2 text-4xl sm:text-5xl leading-tight">
          Nobody can rewrite what happened. Not even Grain.
        </h1>
        <p className="mt-5 text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          Every check of a creator&rsquo;s work, and every forgery caught, goes into Grain&rsquo;s activity log.
          Grain regularly seals that log on Monad: a fingerprint of every entry, in a contract that only accepts
          new seals and can never replace an old one.
        </p>
        <p className="mt-4 text-[15px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          &ldquo;Check&rdquo; downloads the log for a seal, fingerprints it <strong style={{ color: 'var(--ink)' }}>in your browser</strong>,
          and compares that with the seal it reads <strong style={{ color: 'var(--ink)' }}>from Monad directly</strong>. If anyone had
          added, removed, edited or backdated a single entry since, they wouldn&rsquo;t match.
        </p>
        <SealedHistory />
        <div className="mt-12 rounded-lg px-5 py-4 text-[14px] leading-relaxed" style={{ background: 'var(--brand-soft)', color: 'var(--ink-muted)' }}>
          <p className="font-medium" style={{ color: 'var(--ink)' }}>What a seal proves, and what it doesn&rsquo;t</p>
          <p className="mt-1">
            It proves the log hasn&rsquo;t changed since it was sealed. It doesn&rsquo;t prove each check was real: a check
            happens privately in someone&rsquo;s browser, where the chain can&rsquo;t see it. Records and licences are
            different: those are on chain themselves, and fully provable.
          </p>
          <p className="mt-2">
            Contract:{' '}
            <a href={`https://testnet.monadexplorer.com/address/${CONTRACTS.ActivityAnchor}`} target="_blank" rel="noreferrer"
               className="font-mono text-[12px] underline underline-offset-4 break-all">{CONTRACTS.ActivityAnchor} &#8599;</a>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
