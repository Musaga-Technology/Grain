'use client';

import { useEffect } from 'react';
import { prefetch } from '../lib/trustmark';

/**
 * Starts downloading a TrustMark model in the background. On the landing page
 * this means the 45 MB decoder is usually cached before anyone reaches /verify;
 * the browser keeps it, so it is only ever paid for once.
 */
export function Prefetch({ which }: { which: 'verify' | 'register' }) {
  useEffect(() => {
    // Wait for the page to settle so the download never competes with it.
    const t = setTimeout(() => prefetch(which), 1500);
    return () => clearTimeout(t);
  }, [which]);
  return null;
}
