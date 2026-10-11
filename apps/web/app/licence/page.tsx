import type { Metadata } from 'next';
import { Header, Footer } from '../components/Chrome';
import { CONTRACTS } from '../lib/chain';
import { LICENCE_TERMS as TERMS, LICENCE_VERSION } from '../lib/licence';

export const metadata: Metadata = {
  title: 'Grain Licence v1 · Grain',
  description: 'What you may do with an image you licensed through Grain.',
};

/**
 * The one licence a Grain licence grants. A creator who sets a price offers
 * these terms for all their images; a licensee who pays accepts them. The
 * on-chain LicenseRegistry records who paid for what; this page says what that
 * payment buys. Fixed for v1: per-creator terms need a contract change.
 */



export default function Licence() {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-2xl px-5 py-14 sm:py-20">
        <p className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink-faint)' }}>{LICENCE_VERSION}</p>
        <h1 style={{ fontFamily: 'var(--serif)' }} className="mt-2 text-4xl sm:text-5xl leading-tight">
          What a Grain licence lets you do.
        </h1>
        <p className="mt-5 text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          A creator who sets a licence price offers these terms for all their images. Pay the price, by hand or
          through an AI agent, and they&rsquo;re yours for that image. The whole price goes to the creator.
        </p>

        <dl className="mt-10 divide-y rounded-lg border" style={{ borderColor: 'var(--rule)' }}>
          {TERMS.map(([term, text]) => (
            <div key={term} className="px-5 py-4 sm:grid sm:grid-cols-[11rem_1fr] sm:gap-4" style={{ borderColor: 'var(--rule)' }}>
              <dt className="font-medium">{term}</dt>
              <dd className="mt-1 sm:mt-0 text-[15px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>{text}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 rounded-lg px-5 py-4 text-[14px] leading-relaxed" style={{ background: 'var(--brand-soft)', color: 'var(--ink-muted)' }}>
          <p className="font-medium" style={{ color: 'var(--ink)' }}>A hackathon draft, on testnet</p>
          <p className="mt-1">
            Grain runs on Monad testnet, where payments have no real value, and these terms are a plain-language draft,
            not legal advice or a reviewed contract. Before mainnet they&rsquo;ll be reviewed by a lawyer, and creators
            will be able to choose their own terms, such as personal use only or no AI training.
          </p>
          <p className="mt-2">
            Licences are recorded by{' '}
            <a href={`https://testnet.monadscan.com/address/${CONTRACTS.LicenseRegistry}`} target="_blank" rel="noreferrer"
               className="font-mono text-[12px] underline underline-offset-4 break-all">LicenseRegistry &#8599;</a>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
