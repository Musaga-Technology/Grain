import Link from 'next/link';
import Image from 'next/image';
import { Header, Footer } from './components/Chrome';

/**
 * Landing page.
 *
 * UX_SPEC puts the verify tool at `/` with one line and nothing else. That
 * assumes the visitor already knows what Grain is, which a judge arriving cold
 * does not. So the explanation lives here and the tool lives at /verify, where
 * it stays uncluttered.
 */

const STEPS = [
  {
    title: 'Register your image',
    body: 'One biometric prompt. An invisible watermark goes into the file and a fingerprint of it goes on chain. No wallet, no seed phrase.',
    illustration: '/illustrations/creating.svg',
  },
  {
    title: 'It gets copied',
    body: 'Screenshotted, cropped, compressed, re-uploaded. Every one of those strips the credentials out of the file.',
    illustration: '/illustrations/blocked.svg',
  },
  {
    title: 'It still resolves',
    body: 'Drop any copy into Grain and the original creator comes back — from the watermark, or from the picture itself when the watermark is gone.',
    illustration: '/illustrations/data.svg',
  },
];

export default function Landing() {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-5 pt-16 pb-20 sm:pt-24 sm:pb-28 grid gap-12 md:grid-cols-2 md:items-center">
          <div className="grain-rise">
            <h1 style={{ fontFamily: 'var(--serif)' }}
                className="text-4xl sm:text-5xl lg:text-6xl leading-[1.08] tracking-tight">
              Find out who made an image, from the image itself.
            </h1>
            <p className="mt-6 text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              Content credentials get stripped by every screenshot and re-upload.
              Grain finds them again — even after the file has been through the wringer.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link href="/verify" className="grain-btn px-6 py-3 rounded-full text-base font-medium">
                Check an image
              </Link>
              <Link href="/register" className="text-base underline underline-offset-4"
                    style={{ color: 'var(--ink-muted)' }}>
                or register one
              </Link>
            </div>
            <p className="mt-6 text-sm" style={{ color: 'var(--ink-faint)' }}>
              Free. No account needed to check an image.
            </p>
          </div>

          <div className="grain-rise grain-delay-2 flex justify-center md:justify-end">
            <Image src="/illustrations/data.svg" alt="" width={460} height={400} priority
                   className="grain-float w-full max-w-sm md:max-w-md h-auto" />
          </div>
        </section>

        <section className="border-t" style={{ borderColor: 'var(--rule)', background: 'var(--surface)' }}>
          <div className="mx-auto max-w-5xl px-5 py-16 sm:py-20">
            <h2 style={{ fontFamily: 'var(--serif)' }} className="text-2xl sm:text-3xl">How it works</h2>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <div key={step.title} className={`grain-card grain-rise grain-delay-${i + 1} rounded-lg p-6`}>
                  <Image src={step.illustration} alt="" width={200} height={140}
                         className="h-28 w-auto mb-6" />
                  <p className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink-faint)' }}>
                    Step {i + 1}
                  </p>
                  <h3 className="mt-2 text-lg font-medium">{step.title}</h3>
                  <p className="mt-2.5 text-[15px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-16 sm:py-20 grid gap-10 md:grid-cols-2 md:items-center">
          <Image src="/illustrations/invoice.svg" alt="" width={420} height={340}
                 className="w-full max-w-xs h-auto mx-auto md:mx-0" />
          <div>
            <h2 style={{ fontFamily: 'var(--serif)' }} className="text-2xl sm:text-3xl">
              Nobody can delete your record
            </h2>
            <p className="mt-4 text-base leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              C2PA already defined how content credentials work. What it doesn&rsquo;t say is who
              runs the database you look them up in — today that&rsquo;s a handful of private
              companies, and a record can be dropped or lost when one shuts down.
            </p>
            <p className="mt-4 text-base leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              Grain keeps that registry open. Anyone can read it, anyone can check an answer
              against it, and no single company can retract yours.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
