import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Grain',
  description: 'Find out who made an image, from the image itself.',
  openGraph: {
    title: 'Grain',
    description: 'Find out who made an image, from the image itself.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
