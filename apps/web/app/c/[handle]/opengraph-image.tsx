import { ImageResponse } from 'next/og';
import { formatEther } from 'viem';
import { Card, OG_SIZE } from '../../components/og';
import { creatorByHandle } from '../../lib/indexer';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = "A creator's work on Grain";
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const handle = decodeURIComponent((await params).handle).replace(/^@/, '').toLowerCase();
  const c = /^[a-z0-9-]{1,32}$/.test(handle) ? await creatorByHandle(handle) : null;
  if (!c || c === 'unavailable') {
    return new ImageResponse(<Card eyebrow="Creator" headline={`@${handle}`} lines={['on Grain']} footer="Open provenance on Monad" />, size);
  }
  const earned = c.licences.reduce((s, l) => s + BigInt(l.amountWei), 0n);
  const lines = [`${c.recordCount} ${c.recordCount === 1 ? 'image' : 'images'} registered`];
  if (c.licences.length) lines.push(`${c.licences.length} ${c.licences.length === 1 ? 'licence' : 'licences'} · ${Number(formatEther(earned))} MON earned`);
  return new ImageResponse(
    <Card eyebrow="Creator on Grain" headline={`@${c.handle}`} lines={lines}
          fingerprint={c.records[0]?.fingerprint} footer="Every image checkable on Monad" />,
    size,
  );
}
