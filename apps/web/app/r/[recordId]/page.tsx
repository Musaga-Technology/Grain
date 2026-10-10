import type { Metadata } from 'next';
import Link from 'next/link';
import { creditName } from '../../lib/agents';
import { formatEther } from 'viem';
import { Header, Footer } from '../../components/Chrome';
import { loadLicensing, loadRecord } from '../../lib/record-server';
import { Share } from '../../components/Share';
import { MadeWith } from '../../components/Result';

/**
 * A permanent, shareable record page.
 *
 * This is what a creator sends to someone who doubts them, so it has to be
 * legible to a stranger with no context -- and checkable by one who distrusts
 * this website. Everything shown here is read from the chain, and the two
 * checks say what that buys: the manifest is the one the contract recorded,
 * and it was signed by the creator's key.
 */

export const revalidate = 60;

const EXPLORER = 'https://testnet.monadscan.com';

export async function generateMetadata({ params }: { params: Promise<{ recordId: string }> }): Promise<Metadata> {
  const { recordId } = await params;
  const r = await loadRecord(recordId).catch(() => null);
  const who = creditName(r?.handle, r?.agent);
  const title = r ? `${r.title ? `${r.title} — ` : ''}made by ${who} · Grain` : `Record ${recordId} · Grain`;
  const description = r
    ? `Record ${recordId} on Grain, the open provenance registry. Anyone can check it against the chain.`
    : 'A record on Grain, the open provenance registry.';
  return { title, description, openGraph: { title, description, type: 'article' } };
}

function relativeTime(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (s < 90) return 'moments ago';
  if (s < 3600) return ago(Math.floor(s / 60), 'minute');
  if (s < 86400) return ago(Math.floor(s / 3600), 'hour');
  if (s < 86400 * 30) return ago(Math.floor(s / 86400), 'day');
  return ago(Math.floor(s / 86400 / 30), 'month');
}

function Check({ ok, children }: { ok: boolean | undefined; children: React.ReactNode }) {
  if (ok === undefined) return null;
  return (
    <li className="flex gap-3 text-[15px]">
      <span aria-hidden className="w-4 shrink-0" style={{ color: ok ? 'var(--brand)' : 'var(--accent)' }}>
        {ok ? '✓' : '✕'}
      </span>
      <span>{children}</span>
    </li>
  );
}

export default async function RecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params;
  const record = /^\d+$/.test(recordId) ? await loadRecord(recordId).catch(() => null) : null;
  const licensing = record ? await loadLicensing(record.creator, recordId) : null;

  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-xl px-5 py-14 sm:py-20">
        {!record ? (
          <div className="text-center">
            <h1 style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl">No record {recordId}</h1>
            <p className="mt-4" style={{ color: 'var(--ink-muted)' }}>
              Nothing has been registered under that number yet.
            </p>
            <Link href="/verify" className="inline-block mt-8 text-base underline underline-offset-4">
              Check an image instead &rarr;
            </Link>
          </div>
        ) : (
          <article className="grain-rise">
            {record.title && (
              <p className="text-base mb-3" style={{ color: 'var(--ink-muted)' }}>&ldquo;{record.title}&rdquo;</p>
            )}
            <h1 style={{ fontFamily: 'var(--serif)' }} className="text-4xl sm:text-5xl leading-tight">
              Made by{' '}
              {/* Name the human, not the address. */}
              {record.handle ? (
                <Link href={`/c/${record.handle}`} className="whitespace-nowrap underline decoration-1 underline-offset-[6px]"
                      style={{ textDecorationColor: 'var(--rule)' }}>@{record.handle}</Link>
              ) : <span className="whitespace-nowrap">{creditName(null, record.agent)}</span>}
            </h1>
            <MadeWith manifest={{ assertions: { created: record.created } }} agent={record.agent} />
            <p className="mt-3 text-lg" style={{ color: 'var(--ink-muted)' }}>
              registered {relativeTime(record.registeredAt)}
              {record.blockNumber && record.txHash && (
                <>
                  {' · '}
                  <a href={`${EXPLORER}/tx/${record.txHash}`} target="_blank" rel="noreferrer"
                     className="text-sm underline underline-offset-4" style={{ color: 'var(--ink-faint)' }}>
                    block {Number(record.blockNumber).toLocaleString()} &#8599;
                  </a>
                </>
              )}
            </p>

            <div className="mt-6">
              <Share path={`/r/${recordId}`}
                     text={`${record.title ? `“${record.title}” — ` : ''}made by ${record.handle ? `@${record.handle}` : 'its creator'}, registered on Grain. Check any copy of it:`} />
            </div>

            {record.revoked && (
              <p className="mt-6 px-4 py-3 rounded-lg text-[15px]"
                 style={{ background: 'var(--accent-surface)', color: 'var(--accent)' }}>
                The creator has withdrawn this record.
              </p>
            )}
            {record.supersededBy && (
              <p className="mt-6 text-[15px]" style={{ color: 'var(--ink-muted)' }}>
                This version has been edited since.{' '}
                <Link href={`/r/${record.supersededBy}`} className="underline underline-offset-4">
                  See the current one &rarr;
                </Link>
              </p>
            )}

            <ul className="mt-9 space-y-2.5">
              <Check ok={record.manifestMatchesChain}>
                The manifest is the one the contract recorded
              </Check>
              <Check ok={record.signatureValid}>
                It was signed by the creator&rsquo;s key
              </Check>
              {record.manifestUnreadable && (
                <li className="flex gap-3 text-[15px]">
                  <span aria-hidden className="w-4 shrink-0" style={{ color: 'var(--ink-faint)' }}>·</span>
                  <span style={{ color: 'var(--ink-muted)' }}>
                    Its manifest isn&rsquo;t in Grain&rsquo;s format, so there is no signature to check.
                  </span>
                </li>
              )}
              {record.manifest && (record.manifest as { private?: string }).private && (
                <li className="flex gap-3 text-[15px]">
                  <span aria-hidden className="w-4 shrink-0" style={{ color: 'var(--ink-faint)' }}>·</span>
                  <span>Has a private note, encrypted with the creator&rsquo;s passkey: only they can read it</span>
                </li>
              )}
              {record.watermarked !== undefined && (
                <li className="flex gap-3 text-[15px]">
                  <span aria-hidden className="w-4 shrink-0" style={{ color: 'var(--ink-faint)' }}>·</span>
                  <span>
                    {record.watermarked
                      ? 'Carries an invisible TrustMark watermark, and a content fingerprint'
                      : 'Found by content fingerprint (no watermark on this one)'}
                  </span>
                </li>
              )}
            </ul>

            <hr className="my-9 border-0 border-t" style={{ borderColor: 'var(--rule)' }} />

            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-[15px]">
              <dt style={{ color: 'var(--ink-faint)' }}>Record</dt>
              <dd className="font-mono text-[13px]">{recordId}</dd>
              <dt style={{ color: 'var(--ink-faint)' }}>Creator</dt>
              <dd className="font-mono text-[13px] break-all">{record.creator}</dd>
              {record.source && (<>
                <dt style={{ color: 'var(--ink-faint)' }}>Found via</dt>
                <dd className="text-[15px]">
                  {record.source === 'indexer' ? 'Envio indexer, checked against the contract' : 'a log search on chain'}
                </dd>
              </>)}
              <dt style={{ color: 'var(--ink-faint)' }}>Fingerprint</dt>
              <dd className="font-mono text-[13px] break-all">{record.fingerprint}</dd>
              {record.generator && (<>
                <dt style={{ color: 'var(--ink-faint)' }}>Made with</dt>
                <dd className="text-[15px]">{record.generator}</dd>
              </>)}
            </dl>

            {record.manifest && (
              <details className="mt-8">
                <summary className="cursor-pointer text-sm underline underline-offset-4" style={{ color: 'var(--ink-faint)' }}>
                  show the raw manifest
                </summary>
                <pre className="mt-4 p-4 rounded-lg text-[12px] overflow-x-auto border"
                     style={{ background: 'var(--surface)', borderColor: 'var(--rule)' }}>
                  {JSON.stringify(record.manifest, null, 2)}
                </pre>
              </details>
            )}

            {licensing && licensing.priceWei > 0n && (
              <div className="mt-12 rounded-lg border px-5 py-4" style={{ borderColor: 'var(--rule)' }}>
                <p className="text-[15px]">
                  Licensable for <strong>{formatEther(licensing.priceWei)} MON</strong> under the{' '}
                  <Link href="/licence" className="underline underline-offset-4">Grain Licence v1</Link>, paid in full to the creator
                  {licensing.licences ? <> &middot; {licensing.licences} {licensing.licences === 1 ? 'licence' : 'licences'} so far</> : null}
                </p>
                <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
                  AI agents can license it with the MetaMask Agent Wallet:
                </p>
                <code className="mt-2 block rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto"
                      style={{ background: 'var(--surface)' }}>
                  mm grain license {recordId}
                </code>
              </div>
            )}

            <div className="mt-12 rounded-lg px-5 py-4" style={{ background: 'var(--brand-soft)' }}>
              <p className="text-[15px]">Have a copy of this image?</p>
              <Link href="/verify" className="mt-1 inline-block text-[15px] underline underline-offset-4">
                Check whether it&rsquo;s this one &rarr;
              </Link>
            </div>
          </article>
        )}
      </main>
      <Footer />
    </div>
  );
}
