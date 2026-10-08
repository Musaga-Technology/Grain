import type { Metadata } from 'next';
import Link from 'next/link';
import { Header, Footer } from '../components/Chrome';

export const metadata: Metadata = {
  title: 'Grain for your browser',
  description: 'Right-click any image on the web to find out who made it.',
};

const STEPS = [
  <>Download <a href="/grain-extension.zip" className="underline underline-offset-4">grain-extension.zip</a> and unzip it.</>,
  <>Open <span className="font-mono text-[14px]">chrome://extensions</span> and turn on <strong>Developer mode</strong>, top right.</>,
  <>Click <strong>Load unpacked</strong> and choose the unzipped <span className="font-mono text-[14px]">chrome</span> folder.</>,
];

export default function Extension() {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-xl px-5 py-14 sm:py-20">
        <p className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink-faint)' }}>Browser extension</p>
        <h1 style={{ fontFamily: 'var(--serif)' }} className="mt-2 text-4xl sm:text-5xl leading-tight">
          Right-click any image. Find out who made it.
        </h1>
        <p className="mt-5 text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          Choose <strong style={{ color: 'var(--ink)' }}>Who made this image?</strong> on any picture on the web, and
          Grain checks it against the registry: who registered it, and whether its credit is genuine or forged.
        </p>

        <a href="/grain-extension.zip" className="grain-btn mt-9 inline-block rounded-full px-6 py-3 text-base font-medium">
          Download for Chrome
        </a>
        <p className="mt-3 text-sm" style={{ color: 'var(--ink-faint)' }}>Works in Chrome, Edge, Brave and Arc. 5 KB.</p>

        <h2 className="mt-12 text-sm font-medium">Install it in a minute</h2>
        <ol className="mt-4 space-y-4">
          {STEPS.map((s, i) => (
            <li key={i} className="flex gap-4 text-[15px] leading-relaxed">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm"
                    style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>{i + 1}</span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          It isn&rsquo;t on the Chrome Web Store yet, which is why it installs this way.
        </p>

        <div className="mt-12 rounded-lg px-5 py-4" style={{ background: 'var(--brand-soft)' }}>
          <p className="font-medium">What it can see</p>
          <p className="mt-1 text-[15px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            Nothing on its own. Its only permission is the right-click menu: it can&rsquo;t read pages, see your
            browsing or change any site. When you choose it, it hands Grain that one image&rsquo;s address.{' '}
            <a href="https://github.com/Musaga-Technology/Grain/tree/main/extensions/chrome" className="underline underline-offset-4">
              The source is 32 lines.
            </a>
          </p>
        </div>

        <p className="mt-10 text-[15px]">
          No extension? <Link href="/verify" className="underline underline-offset-4">Paste an image link on the check page</Link> instead.
        </p>
      </main>
      <Footer />
    </div>
  );
}
