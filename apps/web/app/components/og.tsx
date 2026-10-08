/**
 * The share cards: what a record or creator link unfolds into on X, Slack,
 * WhatsApp or iMessage. Each one is an advert for Grain that the creator posts
 * themselves, so they are built to read at thumbnail size: one big claim, the
 * record's fingerprint drawn large, and where it can be checked.
 */
export const OG_SIZE = { width: 1200, height: 630 };
const BRAND = '#1f5f4f', INK = '#16151a', MUTED = '#6a6770', PAPER = '#fbfaf8', RULE = '#e5e2dd';

export function Glyph({ fingerprint, size }: { fingerprint: string; size: number }) {
  let fp = 0n;
  try { fp = BigInt(fingerprint); } catch { /* draw empty */ }
  const cell = size / 8;
  const rows = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => ((fp >> BigInt(63 - (r * 8 + c))) & 1n) === 1n));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: size, height: size, border: `2px solid ${RULE}`, borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
      {rows.map((row, r) => (
        <div key={r} style={{ display: 'flex' }}>
          {row.map((on, c) => <div key={c} style={{ width: cell, height: cell, background: on ? BRAND : '#fff', opacity: on ? 0.9 : 1 }} />)}
        </div>
      ))}
    </div>
  );
}

export function Card({ eyebrow, lead, headline, lines, fingerprint, footer }: {
  eyebrow: string; lead?: string; headline: string; lines: string[]; fingerprint?: string; footer: string;
}) {
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', background: PAPER, padding: 72, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 30, height: 30, borderRadius: 999, background: BRAND }} />
          <div style={{ fontSize: 34, color: INK }}>Grain</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 26, color: MUTED, letterSpacing: 2, textTransform: 'uppercase' }}>{eyebrow}</div>
          {lead && <div style={{ fontSize: 40, color: INK, marginTop: 14 }}>{lead}</div>}
          {/* Sized to keep a handle on one line: a break inside @grain-studio reads as two words. */}
          <div style={{ fontSize: headline.length > 18 ? Math.max(44, Math.floor(1240 / headline.length)) : 76, color: INK, fontWeight: 700, marginTop: lead ? 4 : 12, lineHeight: 1.05, maxWidth: 700 }}>{headline}</div>
          {lines.map((l) => <div key={l} style={{ fontSize: 30, color: MUTED, marginTop: 16 }}>{l}</div>)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 24, color: BRAND }}>
          <div style={{ width: 12, height: 12, borderRadius: 999, background: BRAND }} />
          {footer}
        </div>
      </div>
      {fingerprint && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginLeft: 48 }}>
          <Glyph fingerprint={fingerprint} size={340} />
          <div style={{ fontSize: 20, color: MUTED, marginTop: 18 }}>the image&apos;s fingerprint</div>
        </div>
      )}
    </div>
  );
}
