import Link from 'next/link';
import { recentRecords, registryStats, type IndexedRecord } from '../lib/indexer';
import { FingerprintGlyph } from './FingerprintGlyph';
import { creditName } from '../lib/agents';
import { indexedAgent } from '../lib/record-server';

/**
 * The registry, live, on the landing page -- served by the Envio indexer.
 *
 * "What was registered most recently" has no answer on chain short of reading
 * every record, so this section exists because the indexer does. Without one
 * configured, or with it down, the section is simply left out: the landing
 * page explains Grain fine on its own.
 */

export function relativeTime(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 90) return 'moments ago';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) { const d = Math.floor(s / 86400); return `${d} day${d === 1 ? '' : 's'} ago`; }
  { const m = Math.floor(s / 86400 / 30); return `${m} month${m === 1 ? '' : 's'} ago`; }
}

export function RecordRow({ r, showCreator = true, agentName }: { r: IndexedRecord; showCreator?: boolean; agentName?: string }) {
  const handle = r.creatorEntity?.handle;
  return (
    <li>
      <Link href={`/r/${r.recordId}`}
            className="grain-card flex items-center gap-4 rounded-lg px-4 py-3 transition-transform hover:-translate-y-0.5">
        <FingerprintGlyph fingerprint={r.fingerprint} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] truncate">
            Record <span className="font-mono text-[13px]">#{r.recordId}</span>
            {showCreator && (
              <span style={{ color: 'var(--ink-muted)' }}> · {handle ? `@${handle}` : agentName ?? 'unnamed creator'}</span>
            )}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
            block {r.blockNumber.toLocaleString()} · {relativeTime(r.registeredAt)}
          </p>
        </div>
        <span aria-hidden style={{ color: 'var(--ink-faint)' }}>&rarr;</span>
      </Link>
    </li>
  );
}

export async function LiveRegistry() {
  const [recent, stats] = await Promise.all([recentRecords(6), registryStats()]);
  if (!recent || recent.length === 0) return null;
  // An agent's work is credited to the agent by name, once its identity checks out.
  const agents = await Promise.all(recent.map((r) => (r.creatorEntity?.handle ? undefined : indexedAgent(r))));
  return (
    <section className="border-t" style={{ borderColor: 'var(--rule)' }}>
      <div className="mx-auto max-w-5xl px-5 py-16 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs tracking-widest uppercase" style={{ color: 'var(--ink-faint)' }}>
              <span className="grain-live-dot" aria-hidden /> Live from Monad
            </p>
            <h2 style={{ fontFamily: 'var(--serif)' }} className="mt-2 text-2xl sm:text-3xl">
              Recently registered
            </h2>
          </div>
          {stats && (
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
              <strong className="text-base" style={{ color: 'var(--ink)' }}>{stats.records.toLocaleString()}</strong> records
              {' · '}
              <strong className="text-base" style={{ color: 'var(--ink)' }}>{stats.creators.toLocaleString()}</strong> named creators
            </p>
          )}
        </div>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {recent.map((r, i) => {
            const name = creditName(null, agents[i]);
            return <RecordRow key={r.recordId} r={r} agentName={name === 'an unnamed creator' ? undefined : name} />;
          })}
        </ul>
        <p className="mt-6 text-xs" style={{ color: 'var(--ink-faint)' }}>
          Indexed by Envio. Each square is a record&rsquo;s fingerprint — Grain stores those, never the images.
        </p>
      </div>
    </section>
  );
}
