import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, hammingDistance, toBands, type RGBAImage } from '../src/index.ts';

/** Deterministic PRNG -- integer ops only, so fixtures are reproducible anywhere. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 0x100000000;
  };
}

/** A synthetic image with structure -- gradients plus blobs, not pure noise. */
function synth(width: number, height: number, seed = 42): RGBAImage {
  const r = rng(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  const blobs = Array.from({ length: 6 }, () => ({
    cx: r() * width, cy: r() * height, rad: (0.08 + r() * 0.18) * width, v: r() * 255,
  }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 40 + 160 * (x / width) * (1 - y / height);
      for (const b of blobs) {
        // Squared-distance falloff: avoids Math.sqrt so the fixture itself is
        // engine-independent. A known-answer vector is worthless if the fixture
        // that produces it can drift.
        const dx = x - b.cx, dy = y - b.cy;
        const t = (dx * dx + dy * dy) / (b.rad * b.rad);
        if (t < 1) v = v * 0.35 + b.v * 0.65 * (1 - t);
      }
      const p = (y * width + x) * 4;
      data[p] = v; data[p + 1] = v * 0.92; data[p + 2] = v * 0.78; data[p + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Nearest-neighbour downscale -- a crude stand-in for a real re-encode. */
function downscale(img: RGBAImage, factor: number): RGBAImage {
  const width = Math.max(1, Math.round(img.width * factor));
  const height = Math.max(1, Math.round(img.height * factor));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sp = ((Math.floor(y / factor)) * img.width + Math.floor(x / factor)) * 4;
      const dp = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) data[dp + c] = img.data[sp + c];
    }
  }
  return { data, width, height };
}

function brighten(img: RGBAImage, delta: number): RGBAImage {
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = img.data[i] + delta;
    data[i + 1] = img.data[i + 1] + delta;
    data[i + 2] = img.data[i + 2] + delta;
    data[i + 3] = img.data[i + 3];
  }
  return { data, width: img.width, height: img.height };
}

test('is stable across repeated calls', () => {
  const img = synth(256, 256);
  assert.equal(fingerprint(img), fingerprint(img));
});

test('KNOWN ANSWER VECTOR -- the cross-engine anchor', () => {
  // This value is the contract between Node and the browser. The headless
  // browser suite hashes the identical synthetic fixture and must produce this
  // exact bigint. If it ever changes, the hash format changed and every
  // registered record is invalidated -- treat a diff here as a breaking change.
  const fp = fingerprint(synth(256, 256, 42));
  assert.equal(fp, 5859694918063314728n);
});

test('different images hash differently', () => {
  const d = hammingDistance(fingerprint(synth(256, 256, 1)), fingerprint(synth(256, 256, 2)));
  assert.ok(d > 12, `expected distinct images to differ widely, got ${d}`);
});

test('ignores uniform brightness -- the DC term is discarded for this reason', () => {
  const img = synth(256, 256);
  const d = hammingDistance(fingerprint(img), fingerprint(brighten(img, 30)));
  assert.ok(d <= 2, `brightness shift moved the hash by ${d}`);
});

test('survives a 50% downscale within MATCH_THRESHOLD', () => {
  const img = synth(512, 512);
  const d = hammingDistance(fingerprint(img), fingerprint(downscale(img, 0.5)));
  assert.ok(d <= 7, `50% downscale gave distance ${d}, above MATCH_THRESHOLD`);
});

test('non-square images hash without error', () => {
  assert.doesNotThrow(() => fingerprint(synth(640, 200)));
  assert.doesNotThrow(() => fingerprint(synth(200, 640)));
});

test('rejects malformed input', () => {
  assert.throws(() => fingerprint({ data: new Uint8ClampedArray(10), width: 5, height: 5 }));
  assert.throws(() => fingerprint({ data: new Uint8ClampedArray(4), width: 0, height: 1 }));
});

test('hammingDistance counts differing bits', () => {
  assert.equal(hammingDistance(0n, 0n), 0);
  assert.equal(hammingDistance(0n, 0xffn), 8);
  assert.equal(hammingDistance(1n << 63n, 0n), 1);
});

test('toBands splits into 8 bytes, most significant first', () => {
  const bands = toBands(0x0102030405060708n);
  assert.deepEqual(bands, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('PIGEONHOLE: <=7 flipped bits always leaves one band intact', () => {
  // This is the correctness proof for the 8x8 band geometry (SPEC.md 6.3) and
  // the reason MATCH_THRESHOLD cannot exceed 7.
  const r = rng(7);
  for (let trial = 0; trial < 2000; trial++) {
    let fp = 0n;
    for (let i = 0; i < 8; i++) fp = (fp << 8n) | BigInt(Math.floor(r() * 256));

    const flips = 1 + Math.floor(r() * 7);
    let q = fp;
    const seen = new Set<number>();
    while (seen.size < flips) {
      const bit = Math.floor(r() * 64);
      if (seen.has(bit)) continue;
      seen.add(bit);
      q ^= 1n << BigInt(bit);
    }

    const a = toBands(fp), b = toBands(q);
    assert.ok(a.some((v, i) => v === b[i]), `no shared band after ${flips} flips`);
  }
});
