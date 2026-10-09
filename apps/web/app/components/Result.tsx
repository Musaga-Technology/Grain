'use client';

import type { Resolution } from '../lib/types';

/**
 * The four states, each visually distinct.
 * A person should know which one they are looking at from across a room, with
 * the text unreadable.
 *
 * NO CONFIDENCE PERCENTAGE ANYWHERE. "87% match" invites an argument about what
 * 87% means that nobody can settle. Matched, or not.
 */

function relativeTime(unixSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  const day = 86400;
  if (seconds < 60) return 'moments ago';
  const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (seconds < 3600) return ago(Math.floor(seconds / 60), 'minute');
  if (seconds < day) return ago(Math.floor(seconds / 3600), 'hour');
  if (seconds < day * 30) return ago(Math.floor(seconds / day), 'day');
  if (seconds < day * 365) return ago(Math.floor(seconds / day / 30), 'month');
  return ago(Math.floor(seconds / day / 365), 'year');
}

/** Name the human, not the address. */
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
        {record?.creatorHandle ? (
          <a href={`/c/${record.creatorHandle}`} className="whitespace-nowrap underline decoration-1 underline-offset-[6px]"
             style={{ textDecorationColor: 'var(--rule)' }}>{name}</a>
        ) : <span className="whitespace-nowrap">{name}</span>}
      </h2>

      <MadeWith manifest={record?.manifest} agent={record?.agent} />

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

      {record && (
        <a href={`/r/${record.recordId.toString()}`}
           className="mt-6 block w-fit text-[15px] underline underline-offset-4">
          See the full record &rarr;
        </a>
      )}
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

/**
 * How the image was made, as the creator declared and signed it (C2PA's
 * digitalSourceType). Generated media is labelled plainly, so an AI image can
 * never pass as a photograph.
 */
export function MadeWith({ manifest, agent }: {
  manifest?: { assertions?: { created?: { digitalSourceType?: string; softwareAgent?: string } } };
  agent?: { agentId: string; name?: string; verified: boolean };
}) {
  const created = manifest?.assertions?.created;
  if (agent) return <AgentBadge agent={agent} />;
  if (!created?.digitalSourceType) return null;
  const kind = created.digitalSourceType.split('/').pop();
  const label = kind === 'trainedAlgorithmicMedia'
    ? `AI-generated${created.softwareAgent ? ` with ${created.softwareAgent}` : ''}`
    : kind === 'digitalCapture' ? 'Photograph' : kind === 'digitalCreation' ? 'Artwork made by a person' : null;
  if (!label) return null;
  const ai = kind === 'trainedAlgorithmicMedia';
  return (
    <p className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm"
       style={{ background: ai ? '#f1ecfb' : 'var(--brand-soft)', color: ai ? '#5b3fa0' : 'var(--brand)' }}>
      {ai ? '✦' : '●'} {label}
      <span style={{ color: 'var(--ink-faint)' }}>&middot; declared and signed by the creator</span>
    </p>
  );
}

/**
 * An image generated by an AI agent with an ERC-8004 identity. Verified only
 * when the chain confirms the record's signer controls that agent; otherwise
 * the claim is shown, plainly marked as unconfirmed.
 */
function AgentBadge({ agent }: { agent: { agentId: string; name?: string; verified: boolean } }) {
  const who = agent.name ? `${agent.name}` : `agent #${agent.agentId}`;
  return (
    <p className="mt-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl px-3 py-1.5 text-sm"
       style={agent.verified ? { background: '#f1ecfb', color: '#5b3fa0' } : { background: 'var(--accent-surface)', color: 'var(--accent)' }}>
      <span>✦ AI-generated by <strong>{who}</strong></span>
      <a href={`https://testnet.monadscan.com/nft/0x8004A818BFB912233c491871b3d84c89A494BD9e/${agent.agentId}`} target="_blank" rel="noreferrer"
         className="underline underline-offset-2" style={{ color: 'inherit' }}>
        ERC-8004 agent #{agent.agentId}
      </a>
      <span style={{ color: agent.verified ? 'var(--ink-faint)' : 'var(--accent)' }}>
        {agent.verified ? '· identity checked on chain' : '· not confirmed: the signer does not control this agent'}
      </span>
    </p>
  );
}
