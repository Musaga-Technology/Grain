'use client';

import { useEffect, useState } from 'react';

/**
 * Sharing a record is how Grain spreads: every shared link unfolds into a
 * card naming the creator, and everyone who sees it learns Grain exists. So
 * this is one tap -- the phone's own share sheet where there is one, a post to
 * X and a copy button everywhere.
 */
export function Share({ path, text, label = 'Share' }: { path: string; text: string; label?: string }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [native, setNative] = useState(false);
  // window is unknown on the server; resolving after mount keeps hydration exact.
  useEffect(() => {
    setUrl(new URL(path, window.location.origin).toString());
    setNative(typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches);
  }, [path]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };
  const btn = 'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors hover:border-[var(--brand)]';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {native ? (
        <button className={btn} style={{ borderColor: 'var(--rule)' }}
                onClick={() => void navigator.share({ url, text }).catch(() => {})}>
          {label}
        </button>
      ) : (
        <a className={btn} style={{ borderColor: 'var(--rule)' }} target="_blank" rel="noreferrer"
           href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}>
          Post on X
        </a>
      )}
      <button className={btn} style={{ borderColor: 'var(--rule)' }} onClick={() => void copy()} aria-live="polite">
        {copied ? 'Link copied' : 'Copy link'}
      </button>
    </div>
  );
}
