import type { Metadata } from 'next';
import Link from 'next/link';
import { createPublicClient, http, parseAbi } from 'viem';
import { Header, Footer } from '../../components/Chrome';
import { CONTRACTS } from '../../lib/chain';

/**
 * A permanent, shareable record page.
 *
 * This is what a creator sends to someone who doubts them, so it has to be
 * legible to a stranger with no context. Open Graph tags matter more than they
 * look: the disproportionate effect is when a judge pastes the link somewhere.
 */

export const dynamic = 'force-dynamic';

const registryAbi = parseAbi([
  'function records(uint64) view returns ((address creator, uint64 fingerprint, bytes32 manifestHash, uint40 registeredAt, uint64 supersededBy, bool revoked))',
]);

async function loadRecord(recordId: string) {
  try {
    const client = createPublicClient({ transport: http(process.env.NEXT_PUBLIC_RPC_URL) });
    const r = await client.readContract({
      address: CONTRACTS.GrainRegistry, abi: registryAbi, functionName: 'records',
      args: [BigInt(recordId)],
    });
    if (r.creator === '0x0000000000000000000000000000000000000000') return null;
    return r;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ recordId: string }> }): Promise<Metadata> {
  const { recordId } = await params;
  const title = `Record ${recordId} · Grain`;
  const description = 'A registered image on Grain, the open provenance registry.';
  return { title, description, openGraph: { title, description, type: 'article' } };
}

function relativeTime(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} minutes ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return `${Math.floor(s / 86400 / 30)} months ago`;
}

function shortAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default async function RecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params;
  const record = await loadRecord(recordId);

  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-xl px-5 py-14 sm:py-20">
        {!record ? (
          <div className="text-center">
            <h1 style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl">
              No record {recordId}
            </h1>
            <p className="mt-4" style={{ color: 'var(--ink-muted)' }}>
              Nothing has been registered under that number yet.
            </p>
            <Link href="/verify" className="inline-block mt-8 text-base underline underline-offset-4">
              Check an image instead &rarr;
            </Link>
          </div>
        ) : (
          <article className="grain-rise">
            <h1 style={{ fontFamily: 'var(--serif)' }} className="text-4xl sm:text-5xl leading-tight">
              Made by{' '}
              {/* Name the human, not the address. Fall back to a label rather
                  than showing 0x1234 as if it were a name. */}
              <span className="whitespace-nowrap">an unnamed creator</span>
            </h1>
            <p className="mt-3 text-lg" style={{ color: 'var(--ink-muted)' }}>
              registered {relativeTime(Number(record.registeredAt))}
            </p>

            {record.revoked && (
              <p className="mt-6 px-4 py-3 rounded-lg text-[15px]"
                 style={{ background: 'var(--accent-surface)', color: 'var(--accent)' }}>
                The creator has withdrawn this record.
              </p>
            )}

            {record.supersededBy !== 0n && (
              <p className="mt-6 text-[15px]" style={{ color: 'var(--ink-muted)' }}>
                This version has been edited since.{' '}
                <Link href={`/r/${record.supersededBy}`} className="underline underline-offset-4">
                  See the current one &rarr;
                </Link>
              </p>
            )}

            <hr className="my-9 border-0 border-t" style={{ borderColor: 'var(--rule)' }} />

            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-[15px]">
              <dt style={{ color: 'var(--ink-faint)' }}>Record</dt>
              <dd className="font-mono text-[13px]">{recordId}</dd>
              <dt style={{ color: 'var(--ink-faint)' }}>Creator</dt>
              <dd className="font-mono text-[13px]">{shortAddress(record.creator)}</dd>
              <dt style={{ color: 'var(--ink-faint)' }}>Fingerprint</dt>
              <dd className="font-mono text-[13px] break-all">
                0x{record.fingerprint.toString(16).padStart(16, '0')}
              </dd>
            </dl>

            <p className="mt-9 text-sm" style={{ color: 'var(--ink-faint)' }}>
              Anyone can confirm this against the chain — the registry is public and the
              record cannot be retracted by anyone but its creator.
            </p>
          </article>
        )}
      </main>
      <Footer />
    </div>
  );
}
