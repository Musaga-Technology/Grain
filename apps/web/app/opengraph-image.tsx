import { ImageResponse } from 'next/og';
import { Card, OG_SIZE } from './components/og';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Grain: find out who made an image, from the image itself';

export default function Image() {
  return new ImageResponse(
    <Card eyebrow="Open provenance on Monad" headline="Who made this image?"
          lines={['Grain finds out from the image itself,', 'even after screenshots and re-uploads.']}
          fingerprint="0xa5c3f00f9e3c66db" footer="Free to check · no account needed" />,
    size,
  );
}
