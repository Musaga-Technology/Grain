import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodePNG, fingerprint } from '../src/index.ts';

/** Build a minimal valid PNG so the decoder is tested against known pixels. */
function makePNG(w: number, h: number, rgba: number[][], filter = 0): Uint8Array {
  const chunks: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: number[]) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type: string, data: number[]) => {
    const t = [...type].map((c) => c.charCodeAt(0));
    chunks.push(...u32(data.length), ...t, ...data, ...u32(crc([...t, ...data])));
  };

  chunk('IHDR', [...u32(w), ...u32(h), 8, 6, 0, 0, 0]);

  // Apply the filter for real. Writing the filter byte without filtering the
  // bytes produces a file that decodes to different pixels -- which is exactly
  // what a correct decoder should do with it.
  const bpp = 4;
  const stride = w * bpp;
  const flat: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) flat.push(...rgba[y * w + x]);

  const pth = (a: number, b: number, c: number) => {
    const pp = a + b - c;
    const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };

  const raw: number[] = [];
  for (let y = 0; y < h; y++) {
    raw.push(filter);
    for (let i = 0; i < stride; i++) {
      const cur = flat[y * stride + i];
      const a = i >= bpp ? flat[y * stride + i - bpp] : 0;
      const b = y > 0 ? flat[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= bpp ? flat[(y - 1) * stride + i - bpp] : 0;
      let v: number;
      switch (filter) {
        case 1: v = cur - a; break;
        case 2: v = cur - b; break;
        case 3: v = cur - ((a + b) >> 1); break;
        case 4: v = cur - pth(a, b, c); break;
        default: v = cur;
      }
      raw.push(v & 0xff);
    }
  }
  chunk('IDAT', [...deflateSync(Uint8Array.from(raw))]);
  chunk('IEND', []);
  return Uint8Array.from(chunks);
}

test('decodes pixels exactly', () => {
  const px = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [10, 20, 30, 40]];
  const img = decodePNG(makePNG(2, 2, px));
  assert.equal(img.width, 2);
  assert.equal(img.height, 2);
  assert.deepEqual([...img.data], px.flat());
});

test('handles every scanline filter identically', () => {
  const px = Array.from({ length: 64 }, (_, i) => [i * 3, 255 - i * 2, i, 255]);
  const expected = [...decodePNG(makePNG(8, 8, px, 0)).data];
  for (const f of [1, 2, 3, 4]) {
    assert.deepEqual([...decodePNG(makePNG(8, 8, px, f)).data], expected, `filter ${f} diverged`);
  }
});

test('filter choice does not change the fingerprint', () => {
  // The filter is a compression detail. If it reached the hash, identical
  // images saved by different encoders would resolve differently.
  const px = Array.from({ length: 1024 }, (_, i) => [i % 256, (i * 7) % 256, (i * 13) % 256, 255]);
  const base = fingerprint(decodePNG(makePNG(32, 32, px, 0)));
  for (const f of [1, 2, 3, 4]) {
    assert.equal(fingerprint(decodePNG(makePNG(32, 32, px, f))), base, `filter ${f} changed the hash`);
  }
});

test('rejects what it cannot decode rather than guessing', () => {
  assert.throws(() => decodePNG(new Uint8Array(16)), /not a PNG/);
});
