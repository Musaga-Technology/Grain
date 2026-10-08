/**
 * A record's fingerprint, drawn as its own 8x8 grid of bits.
 *
 * Grain never stores images -- only fingerprints -- so listings have no
 * thumbnails to show. This draws the one thing the registry genuinely holds:
 * the 64 bits that identify the picture. Similar pictures draw similar glyphs,
 * which is the whole idea in one small square.
 */
export function FingerprintGlyph({ fingerprint, size = 48 }: { fingerprint: string | bigint; size?: number }) {
  let fp: bigint;
  try { fp = typeof fingerprint === 'bigint' ? fingerprint : BigInt(fingerprint); } catch { fp = 0n; }
  const cells: boolean[] = [];
  for (let i = 63; i >= 0; i--) cells.push(((fp >> BigInt(i)) & 1n) === 1n);
  const cell = size / 8;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
         aria-label="The record's fingerprint" className="shrink-0 rounded-md"
         style={{ background: 'var(--surface)', border: '1px solid var(--rule)' }}>
      {cells.map((on, i) => on && (
        <rect key={i} x={(i % 8) * cell} y={Math.floor(i / 8) * cell} width={cell} height={cell}
              style={{ fill: 'var(--brand)' }} opacity={0.85} />
      ))}
    </svg>
  );
}
