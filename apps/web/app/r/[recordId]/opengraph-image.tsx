import { ImageResponse } from 'next/og';
import { Card, OG_SIZE } from '../../components/og';
import { loadRecord } from '../../lib/record-server';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'A record on Grain, the open provenance registry';
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params;
  const r = /^\d+$/.test(recordId) ? await loadRecord(recordId).catch(() => null) : null;
  if (!r) {
    return new ImageResponse(<Card eyebrow="Grain" headline="Find out who made an image" lines={['from the image itself']} footer="Open provenance on Monad" />, size);
  }
  const date = new Date(r.registeredAt * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return new ImageResponse(
    <Card
      eyebrow={r.title ? `“${r.title.slice(0, 40)}”` : `Record #${recordId}`}
      lead="Made by"
      headline={r.handle ? `@${r.handle}` : 'an unnamed creator'}
      lines={[
        `Registered ${date}`,
        r.created?.digitalSourceType?.endsWith('trainedAlgorithmicMedia')
          ? `AI-generated${r.created.softwareAgent ? ` with ${r.created.softwareAgent}` : ''} · declared by the creator`
          : r.watermarked ? 'Invisible watermark + fingerprint' : 'Content fingerprint',
      ]}
      fingerprint={r.fingerprint}
      footer={r.revoked ? 'Withdrawn by its creator' : 'Verified on Monad · checkable by anyone'}
    />,
    size,
  );
}
