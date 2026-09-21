import { inflateSync } from 'node:zlib';
import type { RGBAImage } from './fingerprint.ts';

/**
 * Minimal PNG decoder producing raw RGBA.
 *
 * Owned rather than delegated, for the same reason the resize and the DCT table
 * are owned (see fingerprint.ts): the fingerprint must be bit-identical
 * everywhere, and platform decoders are not. PNG is a good place to start
 * because it is lossless and fully specified -- two conforming decoders cannot
 * disagree about the pixels, unlike JPEG, where IDCT tolerances legitimately
 * differ between implementations.
 *
 * Supports 8-bit greyscale, RGB, and their alpha variants, non-interlaced.
 * That covers every PNG the pipeline produces. Anything else throws rather
 * than guessing, because a silently mis-decoded image yields a plausible-looking
 * fingerprint that is simply wrong.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePNG(buf: Uint8Array): RGBAImage {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat: Uint8Array[] = [];

  while (pos < buf.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    const body = pos + 8;

    if (type === 'IHDR') {
      width = view.getUint32(body);
      height = view.getUint32(body + 4);
      depth = buf[body + 8];
      colorType = buf[body + 9];
      interlace = buf[body + 12];
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(body, body + len));
    } else if (type === 'IEND') {
      break;
    }
    pos = body + len + 4; // skip CRC
  }

  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}; only 8 is handled`);
  if (interlace !== 0) throw new Error('interlaced PNG is not supported');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const merged = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of idat) { merged.set(c, off); off += c.length; }
  const raw = new Uint8Array(inflateSync(merged));

  // Undo per-scanline filtering (PNG spec 9.2).
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const v = raw[rp + x];
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let r: number;
      switch (filter) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
      line[x] = r & 0xff;
    }
    rp += stride;
  }

  // Expand to RGBA.
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0, q = 0; i < width * height; i++, p += channels, q += 4) {
    if (channels === 1) {
      data[q] = data[q + 1] = data[q + 2] = out[p]; data[q + 3] = 255;
    } else if (channels === 2) {
      data[q] = data[q + 1] = data[q + 2] = out[p]; data[q + 3] = out[p + 1];
    } else if (channels === 3) {
      data[q] = out[p]; data[q + 1] = out[p + 1]; data[q + 2] = out[p + 2]; data[q + 3] = 255;
    } else {
      data[q] = out[p]; data[q + 1] = out[p + 1]; data[q + 2] = out[p + 2]; data[q + 3] = out[p + 3];
    }
  }

  return { data, width, height };
}
