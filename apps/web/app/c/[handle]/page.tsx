import type { Metadata } from 'next';
import Link from 'next/link';
import { Header, Footer } from '../../components/Chrome';
import { RecordRow } from '../../components/LiveRegistry';
import { creatorByHandle } from '../../lib/indexer';

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
            <p className="mt-3 text-lg" style={{ color: 'var(--ink-muted)' }}>
              {creator.recordCount.toLocaleString()} {creator.recordCount === 1 ? 'image' : 'images'} registered
            </p>
            <p className="mt-2 font-mono text-[12px] break-all" style={{ color: 'var(--ink-faint)' }}>
              <a href={`https://testnet.monadexplorer.com/address/${creator.address}`} target="_blank" rel="noreferrer"
                 className="underline underline-offset-4">{creator.address} &#8599;</a>
            </p>
            <ul className="mt-10 grid gap-3">
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
