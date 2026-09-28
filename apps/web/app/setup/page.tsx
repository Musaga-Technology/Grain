'use client';

import { useEffect, useState } from 'react';
import { createPasskeyWithPrfOutput, isMeraError } from '@category-labs/mera';
import { Header, Footer } from '../components/Chrome';
import { checkPasskeySupport, prfAdvice } from '../lib/passkey-support';

/**
 * Demo-machine check (SPEC.md §9.2).
 *
 * Milestone 0 asks for PRF to be verified on the actual demo browser and
 * device, and for PRF_UNAVAILABLE to be reproduced deliberately so the error
 * copy is tested rather than assumed. This page does both on demand.
 *
 * Deliberately not linked from anywhere. It is a tool, not a surface.
 */

type Check = { label: string; state: 'pending' | 'pass' | 'fail'; detail?: string };

export default function Setup() {
  const [checks, setChecks] = useState<Check[]>([
    { label: 'Secure connection', state: 'pending' },
    { label: 'WebAuthn available', state: 'pending' },
    { label: 'Biometric or device unlock', state: 'pending' },
  ]);
  const [prf, setPrf] = useState<Check>({ label: 'PRF extension (the one that matters)', state: 'pending' });
  const [advice, setAdvice] = useState<{ headline: string; steps: string[] } | null>(null);
  const [agent, setAgent] = useState('');

  useEffect(() => {
    setAgent(navigator.userAgent);
    void (async () => {
      const secure = typeof window !== 'undefined' && window.isSecureContext;
      const webauthn = typeof window !== 'undefined' && !!window.PublicKeyCredential;
      const support = await checkPasskeySupport();
      setChecks([
        { label: 'Secure connection', state: secure ? 'pass' : 'fail',
          detail: secure ? location.origin : 'PRF requires https or localhost' },
        { label: 'WebAuthn available', state: webauthn ? 'pass' : 'fail' },
        {
          label: 'Biometric or device unlock',
          state: support.ok || support.reason !== 'no-platform-authenticator' ? 'pass' : 'fail',
          detail: support.ok ? undefined : support.message,
        },
      ]);
    })();
  }, []);

  /**
   * The only honest test is to actually create one. This DOES leave a passkey
   * behind -- that is inherent to how PRF is evaluated, not something the page
   * can avoid -- so the button says so plainly.
   */
  const testPrf = async () => {
    setPrf({ label: prf.label, state: 'pending', detail: 'waiting for your device…' });
    setAdvice(null);
    try {
      const result = await createPasskeyWithPrfOutput({
        rp: { id: location.hostname, name: 'Grain setup check' },
        user: { name: 'setup-check', displayName: 'Grain setup check' },
      });
      setPrf({
        label: prf.label,
        state: 'pass',
        detail: `PRF returned ${result.prfOutput.length} bytes. This machine can register images.`,
      });
    } catch (e) {
      const code = isMeraError(e) ? e.code : 'UNKNOWN';
      setPrf({ label: prf.label, state: 'fail', detail: code });
      if (code === 'PRF_UNAVAILABLE') setAdvice(prfAdvice());
      console.error('setup check failed', e);
    }
  };

  const mark = (s: Check['state']) => (s === 'pass' ? '✓' : s === 'fail' ? '✕' : '·');
  const colour = (s: Check['state']) =>
    s === 'pass' ? 'var(--brand)' : s === 'fail' ? 'var(--accent)' : 'var(--ink-faint)';

  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-xl px-5 py-14">
        <h1 style={{ fontFamily: 'var(--serif)' }} className="text-3xl">Setup check</h1>
        <p className="mt-3 text-[15px]" style={{ color: 'var(--ink-muted)' }}>
          Whether this browser and device can register images.
        </p>

        <ul className="mt-8 space-y-3">
          {[...checks, prf].map((c) => (
            <li key={c.label} className="flex gap-3 text-[15px]">
              <span aria-hidden style={{ color: colour(c.state) }} className="w-4 shrink-0">{mark(c.state)}</span>
              <span>
                {c.label}
                {c.detail && (
                  <span className="block text-sm mt-0.5" style={{ color: 'var(--ink-faint)' }}>{c.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>

        <button onClick={testPrf} className="grain-btn mt-8 px-6 py-3 rounded-full text-base font-medium">
          Test it
        </button>
        <p className="mt-3 text-sm" style={{ color: 'var(--ink-faint)' }}>
          This creates a throwaway passkey called “Grain setup check”. Delete it afterwards if you like.
        </p>

        {advice && (
          <div className="mt-9 rounded-lg px-5 py-5" style={{ background: 'var(--accent-surface)' }}>
            <p className="font-medium" style={{ color: 'var(--accent)' }}>{advice.headline}</p>
            <ol className="mt-3 space-y-2">
              {advice.steps.map((s, i) => (
                <li key={i} className="text-[15px] leading-relaxed">{i + 1}. {s}</li>
              ))}
            </ol>
          </div>
        )}

        <p className="mt-10 text-xs font-mono break-all" style={{ color: 'var(--ink-faint)' }}>{agent}</p>
      </main>
      <Footer />
    </div>
  );
}
