import type { Metadata } from 'next';
import Link from 'next/link';
import { Header, Footer } from '../../components/Chrome';
import { formatEther } from 'viem';
import { RecordRow, relativeTime } from '../../components/LiveRegistry';
import { creatorByHandle, type CreatorPage } from '../../lib/indexer';
import { Share } from '../../components/Share';
import { Activity } from '../../components/Activity';
import { activityEnabled, activityFor } from '../../lib/activity';

/**
 * A creator's portfolio: every record registered under one name.
 *
 * The contracts can answer "who made this record" but not "what has this
 * person made" without scanning every record, so this page is served by the
 * Envio indexer. Each record still links to its own page, which re-checks it
 * against the chain.
 */

export const revalidate = 30;

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const title = `@${decodeURIComponent(handle)} on Grain`;
  return { title, description: `Images registered by @${decodeURIComponent(handle)} on Grain, the open provenance registry.` };
}

export default async function CreatorPage({ params }: { params: Promise<{ handle: string }> }) {
  const handle = decodeURIComponent((await params).handle).replace(/^@/, '').toLowerCase();
  const creator = /^[a-z0-9-]{1,32}$/.test(handle) ? await creatorByHandle(handle) : null;
  const events = creator && creator !== 'unavailable' && activityEnabled() ? await activityFor(creator.address) : null;

  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-2xl px-5 py-14 sm:py-20">
        {creator === 'unavailable' ? (
          <div className="text-center">
            <h1 style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl">@{handle}</h1>
            <p className="mt-4" style={{ color: 'var(--ink-muted)' }}>
              Creator listings come from Grain&rsquo;s indexer, which isn&rsquo;t answering right now.
              Every record is still on chain, and checking an image still works.
            </p>
            <Link href="/verify" className="inline-block mt-8 underline underline-offset-4">Check an image &rarr;</Link>
          </div>
        ) : !creator ? (
          <div className="text-center">
            <h1 style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl">No creator called @{handle}</h1>
            <p className="mt-4" style={{ color: 'var(--ink-muted)' }}>
              Nobody has registered under that name yet.
            </p>
            <Link href="/register" className="inline-block mt-8 underline underline-offset-4">Claim it by registering an image &rarr;</Link>
          </div>
        ) : (
          <article className="grain-rise">
            <p className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink-faint)' }}>Creator</p>
            <h1 style={{ fontFamily: 'var(--serif)' }} className="mt-2 text-4xl sm:text-5xl">@{creator.handle}</h1>
            <p className="mt-3 font-mono text-[12px] break-all" style={{ color: 'var(--ink-faint)' }}>
              <a href={`https://testnet.monadscan.com/address/${creator.address}`} target="_blank" rel="noreferrer"
                 className="underline underline-offset-4">{creator.address} &#8599;</a>
            </p>
            <div className="mt-6">
              <Share path={`/c/${creator.handle}`} text={`My work on Grain: every image checkable on Monad, even after screenshots.`} />
            </div>

            <Earnings creator={creator} />

            {events && <Activity handle={creator.handle} events={events} />}

            <h2 className="mt-12 text-sm font-medium">Images</h2>
            <ul className="mt-3 grid gap-3">
              {creator.records.map((r) => <RecordRow key={r.recordId} r={r} showCreator={false} />)}
            </ul>
            {creator.recordCount > creator.records.length && (
              <p className="mt-4 text-sm" style={{ color: 'var(--ink-faint)' }}>
                Showing the latest {creator.records.length}.
              </p>
            )}
          </article>
        )}
      </main>
      <Footer />
    </div>
  );
}

const EXPLORER = 'https://testnet.monadscan.com';
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** MON with no more decimals than it needs: 0.01, 1.25, 12. */
const mon = (wei: bigint) => {
  const n = Number(formatEther(wei));
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 4 : 2 });
};

/**
 * What a creator gets back for registering: the money their work has earned.
 * Every figure is a sum over LicenseGranted events, so it is exactly what the
 * chain says was paid to them, and each licence links to its transaction.
 */
function Earnings({ creator }: { creator: CreatorPage }) {
  const earned = creator.licences.reduce((sum, l) => sum + BigInt(l.amountWei), 0n);
  const price = BigInt(creator.licencePriceWei);
  const stats = [
    { label: creator.recordCount === 1 ? 'image' : 'images', value: creator.recordCount.toLocaleString() },
    { label: 'MON earned', value: mon(earned) },
    { label: creator.licences.length === 1 ? 'licence sold' : 'licences sold', value: creator.licences.length.toLocaleString() },
  ];
  return (
    <section className="mt-8">
      <dl className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="grain-card rounded-lg px-4 py-4">
            <dd style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl leading-none">{s.value}</dd>
            <dt className="mt-2 text-[13px]" style={{ color: 'var(--ink-muted)' }}>{s.label}</dt>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm" style={{ color: 'var(--ink-muted)' }}>
        {price > 0n
          ? <>Licensable at <strong style={{ color: 'var(--ink)' }}>{mon(price)} MON</strong> per image under the <a href="/licence" className="underline underline-offset-4">Grain Licence v1</a>, paid in full to @{creator.handle}. AI agents license with <code className="font-mono text-[13px] whitespace-nowrap">mm grain license</code>.</>
          : <>Not licensable yet. A licence price can be set when registering an image.</>}
      </p>

      {creator.licences.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-medium">Recent licences</h2>
          <ul className="mt-3 divide-y rounded-lg border" style={{ borderColor: 'var(--rule)' }}>
            {creator.licences.slice(0, 10).map((l) => (
              <li key={l.txHash} className="flex items-center justify-between gap-4 px-4 py-3 text-[14px]" style={{ borderColor: 'var(--rule)' }}>
                <span className="min-w-0">
                  <Link href={`/r/${l.recordId}`} className="underline underline-offset-4">Record #{l.recordId}</Link>
                  <span className="block sm:inline" style={{ color: 'var(--ink-muted)' }}>
                    <span className="hidden sm:inline"> </span>licensed by <span className="font-mono text-[12px]" style={{ color: 'var(--ink)' }}>{short(l.licensee)}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-medium" style={{ color: 'var(--brand)' }}>+{mon(BigInt(l.amountWei))} MON</span>
                  <a href={`${EXPLORER}/tx/${l.txHash}`} target="_blank" rel="noreferrer"
                     className="block text-xs underline underline-offset-2" style={{ color: 'var(--ink-faint)' }}>
                    {relativeTime(l.grantedAt)} &#8599;
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
