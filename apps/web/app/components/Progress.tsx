'use client';

/**
 * A progress line, not a spinner (UX_SPEC "Processing").
 *
 * The three steps are truthful -- they map to image decode, TrustMark decode,
 * and the fingerprint fan-out. Never a percentage bar for work that cannot be
 * measured.
 *
 * Past four seconds the outstanding step is named rather than left to a
 * generic wait. That matters here: a resolve is currently 3.2-3.8s, dominated
 * by loading the watermark model (docs/RESOLVER.md).
 */
const STEPS = ['Reading the image', 'Checking the watermark', 'Searching by content'] as const;

export function Progress({ step, slow }: { step: number; slow: boolean }) {
  return (
    <div className="grain-rise w-full max-w-xl mx-auto px-6 py-10" aria-live="polite">
      <ol className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-base">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-3">
            <span
              className={i === step ? 'grain-pulse' : undefined}
              style={{ color: i < step ? 'var(--ink)' : i === step ? 'var(--ink)' : 'var(--ink-faint)' }}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden className="hidden sm:inline" style={{ color: 'var(--ink-faint)' }}>&rarr;</span>
            )}
          </li>
        ))}
      </ol>
      {slow && (
        <p className="mt-5 text-sm" style={{ color: 'var(--ink-faint)' }}>
          Still {STEPS[step].toLowerCase()}. Large images take a moment.
        </p>
      )}
    </div>
  );
}
