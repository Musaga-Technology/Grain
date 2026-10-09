import type { Metadata } from 'next';
import { Header, Footer } from '../components/Chrome';
import { YourWork } from '../components/YourWork';

export const metadata: Metadata = {
  title: 'Your work · Grain',
  description: 'Everything you have registered on Grain, unlocked with your passkey.',
};

export default function Me() {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-2xl px-5 py-14 sm:py-20">
        <YourWork />
      </main>
      <Footer />
    </div>
  );
}
