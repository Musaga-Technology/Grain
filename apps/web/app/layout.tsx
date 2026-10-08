import type { Metadata } from 'next';
import './globals.css';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://grain-on-monad.vercel.app';

export const metadata: Metadata = {
  // Share cards need absolute URLs; without this they point at localhost.
  metadataBase: new URL(SITE),
  title: 'Grain',
  description: 'Find out who made an image, from the image itself.',
  openGraph: {
    title: 'Grain',
    description: 'Find out who made an image, from the image itself.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
