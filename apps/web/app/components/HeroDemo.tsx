/**
 * The hero shows the product rather than a stock illustration: a picture,
 * the copies it went through, and the verdict. The picture is drawn rather than
 * photographed on purpose -- putting an example creator's name on a real
 * photographer's work would be a small misattribution on a provenance product.
 */
export function HeroDemo() {
  return (
    <div className="relative w-full max-w-md mx-auto md:mx-0 md:ml-auto select-none" aria-hidden>
      <div className="grain-float rounded-2xl overflow-hidden border shadow-sm"
           style={{ borderColor: 'var(--rule)', background: 'var(--surface)' }}>
        <svg viewBox="0 0 400 280" className="block w-full h-auto">
          <rect width="400" height="280" fill="#e9efe9" />
          <circle cx="292" cy="78" r="34" fill="#f2c27b" />
          <path d="M0 196 C 70 150, 120 170, 190 140 S 320 120, 400 150 L400 280 L0 280 Z" fill="#9cbfa7" />
          <path d="M0 226 C 90 190, 160 214, 240 186 S 350 180, 400 196 L400 280 L0 280 Z" fill="#4f8a6c" />
          <path d="M0 252 C 110 232, 210 250, 300 230 S 380 236, 400 240 L400 280 L0 280 Z" fill="#1f5f4f" />
          <g fill="#1f5f4f" opacity=".85">
            <path d="M70 214 l9 -26 l9 26 z" /><path d="M86 220 l7 -20 l7 20 z" />
          </g>
        </svg>
      </div>

      {/* What happened to the copy. */}
      <div className="absolute -left-3 sm:-left-6 top-6 flex flex-col gap-2">
        {['screenshot', 'cropped', 'JPEG 20%'].map((t, i) => (
          <span key={t}
                className={`grain-rise grain-delay-${i + 1} text-xs px-3 py-1.5 rounded-full border shadow-sm`}
                style={{ background: 'var(--paper)', borderColor: 'var(--rule)', color: 'var(--ink-muted)' }}>
            {t}
          </span>
        ))}
      </div>

      {/* And the answer that survives it. */}
      <div className="grain-rise grain-delay-3 absolute -bottom-8 right-2 sm:-right-4 rounded-xl border px-5 py-4 shadow-md max-w-[16rem]"
           style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}>
        <p style={{ fontFamily: 'var(--serif)' }} className="text-xl leading-tight">Made by @grain-studio</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>registered on Monad &middot; record #511</p>
        <p className="mt-2 text-xs" style={{ color: 'var(--ink-faint)' }}>matched by watermark and content</p>
      </div>
    </div>
  );
}
