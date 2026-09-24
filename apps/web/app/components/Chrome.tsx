import Link from 'next/link';

export function Header() {
  return (
    <header className="w-full border-b" style={{ borderColor: 'var(--rule)' }}>
      <div className="mx-auto max-w-5xl px-5 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <span aria-hidden className="inline-block w-5 h-5 rounded-full"
                style={{ background: 'var(--brand)' }} />
          <span style={{ fontFamily: 'var(--serif)' }} className="text-xl">Grain</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/verify" className="hover:underline underline-offset-4">Verify</Link>
          <Link href="/register" className="grain-btn px-4 py-2 rounded-full text-sm">
            Register an image
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="w-full border-t mt-auto" style={{ borderColor: 'var(--rule)' }}>
      <div className="mx-auto max-w-5xl px-5 py-8 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-sm"
           style={{ color: 'var(--ink-faint)' }}>
        <p>An open registry for content provenance. Built on Monad.</p>
        <p>
          C2PA-compatible &middot;{' '}
          <a href="https://github.com/Musaga-Technology/Grain" className="hover:underline underline-offset-4">
            Source
          </a>
        </p>
      </div>
    </footer>
  );
}
