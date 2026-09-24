import { deflateSync } from 'node:zlib';
import type { RGBAImage } from './fingerprint.ts';

/**
 * Minimal PNG encoder, 8-bit RGBA, no filtering.
 *
 * Filter type 0 throughout: filtering is a compression optimisation and the
 * decoder proves the choice cannot reach the fingerprint, so there is nothing
 * to gain here beyond file size. Keeping it trivial keeps it auditable.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePNG(img: RGBAImage): Uint8Array {
  const { width, height, data } = img;
  const parts: Uint8Array[] = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];

  const chunk = (type: string, body: Uint8Array) => {
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(0, body.length);
    for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
    const crcInput = new Uint8Array(4 + body.length);
    crcInput.set(head.subarray(4, 8), 0);
    crcInput.set(body, 4);
    const tail = new Uint8Array(4);
    new DataView(tail.buffer).setUint32(0, crc32(crcInput));
    parts.push(head, body, tail);
  };

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  chunk('IHDR', ihdr);

  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  chunk('IDAT', new Uint8Array(deflateSync(raw)));
  chunk('IEND', new Uint8Array(0));

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
