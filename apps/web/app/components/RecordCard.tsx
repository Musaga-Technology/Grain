/**
 * Illustrates "nobody can delete your record" with what a record actually is,
 * rather than a stock invoice -- which, with a dollar sign on it, pulled the
 * page toward exactly the money-and-crypto reading the product avoids.
 */
export function RecordCard() {
  const rows: [string, string][] = [
    ['Made by', '@grain-studio'],
    ['Registered', 'block 69,268,419'],
    ['Fingerprint', '0xc1c2c2265d5b3e3c'],
    ['Watermark', 'TrustMark Q'],
  ];
  return (
    <div className="relative w-full max-w-sm mx-auto md:mx-0" aria-hidden>
      <div className="absolute inset-0 translate-x-4 translate-y-4 rounded-xl border opacity-50"
           style={{ borderColor: 'var(--rule)', background: 'var(--surface)' }} />
      <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-xl border opacity-75"
           style={{ borderColor: 'var(--rule)', background: 'var(--surface)' }} />
      <div className="relative rounded-xl border px-6 py-5" style={{ borderColor: 'var(--rule)', background: 'var(--paper)' }}>
        <p className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink-faint)' }}>Record 511</p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt style={{ color: 'var(--ink-faint)' }}>{k}</dt>
              <dd className={k === 'Made by' ? '' : 'font-mono text-[13px]'}>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 pt-4 border-t text-xs" style={{ borderColor: 'var(--rule)', color: 'var(--ink-muted)' }}>
          Permanent · public · checkable by anyone
        </p>
      </div>
    </div>
  );
}
