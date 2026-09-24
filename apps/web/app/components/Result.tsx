'use client';

import type { Resolution } from '../lib/types';

/**
 * The four states, each visually distinct (UX_SPEC "The four states").
 * A person should know which one they are looking at from across a room, with
 * the text unreadable.
 *
 * NO CONFIDENCE PERCENTAGE ANYWHERE. "87% match" invites an argument you cannot
 * win in front of judges. Matched, or not.
 */

function relativeTime(unixSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  const day = 86400;
  if (seconds < 60) return 'moments ago';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < day) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < day * 30) return `${Math.floor(seconds / day)} days ago`;
  if (seconds < day * 365) return `${Math.floor(seconds / day / 30)} months ago`;
  return `${Math.floor(seconds / day / 365)} years ago`;
}

/** Name the human, not the address (UX_SPEC "Copy principles"). */
function creatorName(handle: string | undefined): string {
  return handle ? `@${handle}` : 'an unnamed creator';
}

function howItMatched(via: string): string {
  if (via === 'both') return 'matched by watermark and content';
  if (via === 'watermark') return 'matched by watermark';
  return 'matched by content';
}

function Shell({ children, alarm = false }: { children: React.ReactNode; alarm?: boolean }) {
  return (
    <div
      className="grain-rise w-full max-w-xl mx-auto px-6 py-10 sm:py-14 rounded-sm"
      style={alarm ? { background: 'var(--accent-surface)' } : undefined}
    >
      {children}
    </div>
  );
}

export function Result({ result, onVerifyOnChain, chainDistance }: {
  result: Resolution;
  onVerifyOnChain?: () => void;
  chainDistance?: number | null;
}) {
  if (result.state === 'NOT_FOUND') {
    // Quiet. MUST NOT look like an error: most images on earth are
    // unregistered, which is the starting condition, not a bug.
    return (
      <Shell>
        <h2 style={{ fontFamily: 'var(--serif)' }} className="text-3xl sm:text-4xl leading-tight">
          No record for this image
        </h2>
        <p className="mt-4 text-base leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          It may never have been registered, or it&rsquo;s been edited past recognition.
        </p>
        <a href="/register" className="inline-block mt-8 text-base underline underline-offset-4">
          Register an image &rarr;
        </a>
      </Shell>
    );
  }

  if (result.state === 'TAMPERED') {
    // The only place the accent colour is used at full strength.
    const name = creatorName(result.claimed.creatorHandle);
    return (
      <Shell alarm>
        <h2 style={{ fontFamily: 'var(--serif)', color: 'var(--accent)' }}
            className="text-3xl sm:text-4xl leading-tight">
          This image is claiming someone else&rsquo;s credentials
        </h2>
        <p className="mt-4 text-base leading-relaxed" style={{ color: 'var(--ink)' }}>
          It carries {name}&rsquo;s watermark, but the picture doesn&rsquo;t match what {name}{' '}
          registered. Someone copied the mark onto a different image.
        </p>
        <VerifyOnChain onVerify={onVerifyOnChain} distance={chainDistance} prominent />
      </Shell>
    );
  }

  const record = result.state === 'RESOLVED' ? result.record : result.candidates[0];
  const uncertain = result.state === 'UNCERTAIN';
  const name = creatorName(record?.creatorHandle);

  return (
    <Shell>
      <h2 style={{ fontFamily: 'var(--serif)' }} className="text-4xl sm:text-5xl leading-tight">
        {uncertain ? 'Probably made by ' : 'Made by '}
        <span className="whitespace-nowrap">{name}</span>
      </h2>

      {record && (
        <p className="mt-3 text-lg" style={{ color: 'var(--ink-muted)' }}>
          registered {relativeTime(record.registeredAt)}
        </p>
      )}

      {uncertain && (
        <p className="mt-5 text-base leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          This copy has been heavily edited. The match is close but not exact.
        </p>
      )}

      <hr className="my-8 border-0 border-t" style={{ borderColor: 'var(--rule)' }} />

      <p className="text-base" style={{ color: 'var(--ink-muted)' }}>
        {result.state === 'RESOLVED' ? howItMatched(result.via) : 'matched by content'}
      </p>

      <VerifyOnChain onVerify={onVerifyOnChain} distance={chainDistance} />
    </Shell>
  );
}

/**
 * Calls the contract directly and shows the distance it returned. This is how
 * a sceptic confirms the indexer is not lying -- and the answer to "why not
 * just a database", made operable rather than argued.
 */
function VerifyOnChain({ onVerify, distance, prominent = false }: {
  onVerify?: () => void; distance?: number | null; prominent?: boolean;
}) {
  if (!onVerify) return null;
  if (distance !== null && distance !== undefined) {
    return (
      <p className="mt-4 text-sm" style={{ color: 'var(--ink-faint)' }}>
        confirmed on chain &middot; difference of {distance} {distance === 1 ? 'bit' : 'bits'}
      </p>
    );
  }
  return (
    <button
      onClick={onVerify}
      className={`mt-4 text-sm underline underline-offset-4 ${prominent ? 'font-medium' : ''}`}
      style={{ color: prominent ? 'var(--ink)' : 'var(--ink-faint)' }}
    >
      verify on chain &#8599;
    </button>
  );
}
