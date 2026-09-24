import { DCT_BASIS, DCT_K, DCT_N } from './dct-basis.ts';

/**
 * 64-bit DCT-based perceptual hash (SPEC.md 5.1).
 *
 * DETERMINISM IS THE POINT. A fingerprint computed in the browser and one
 * computed in Node must be bit-identical, because the browser registers and
 * the resolver verifies. Two rules follow, and both are load-bearing:
 *
 *  1. The canonical input is raw RGBA, never a file. Platform image decoders
 *     do NOT agree bit-for-bit -- JPEG IDCT tolerances differ between decoders,
 *     and browsers additionally apply ICC/colour-management and premultiplied
 *     alpha through canvas. Decoding is an adapter's job (see decode.ts); this
 *     module starts after the pixels exist.
 *
 *  2. No transcendental functions run here. The DCT basis is a committed table
 *     (dct-basis.ts) because Math.cos is implementation-approximated and V8 and
 *     JavaScriptCore need not agree. Everything below is +, -, * and /, which
 *     IEEE-754 pins exactly.
 */

export interface RGBAImage {
  /** Row-major RGBA, 4 bytes per pixel, length === width * height * 4. */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export const FINGERPRINT_BITS = 64;

/**
 * Hamming distance at or below this is a match.
 *
 * Cannot exceed 7: the 8x8 LSH band geometry only guarantees recall to
 * distance 7 (SPEC.md 6.3), so a higher threshold would claim matches the
 * index cannot reliably find.
 */
export const MATCH_THRESHOLD = 7;

/**
 * Watermark resolves but fingerprint exceeds this -> TAMPERED.
 *
 * RAISED FROM THE SPEC'S 12 TO 16, from Milestone 0 measurement.
 *
 * A 10% crop leaves the watermark intact (100% recovery across 21 fixtures)
 * while moving the fingerprint a median of 12 and as far as 28. At a threshold
 * of 12, seven of those 21 legitimate crops would be reported as TAMPERED --
 * a third of people who crop their own photograph told they are passing off
 * someone else's credentials. That is the alarm state firing on innocent
 * content, which is worse than missing an attack.
 *
 * Measured separation, 210 unrelated fixture pairs: minimum distance 18,
 * 1st percentile 22, median 32. Against crop-10% distances:
 *
 *   T=12  ->  7/21 crops falsely flagged,   0/210 transfers missed
 *   T=16  ->  2/21 crops falsely flagged,   0/210 transfers missed
 *   T=20  ->  1/21 crops falsely flagged,   2/210 transfers missed
 *   T=28  ->  0/21 crops falsely flagged,  63/210 transfers missed
 *
 * 16 is the point where false accusations are nearly gone and no genuine
 * transfer escapes. Re-derive this if the fingerprint changes.
 */
export const TAMPER_THRESHOLD = 16;

/**
 * BT.601 luma, rounded half-up, per SPEC.md 5.1 step 2.
 * Greyscale happens before the resize so the box filter averages luma rather
 * than three channels independently.
 */
function toLuma(img: RGBAImage): Float64Array {
  const { data, width, height } = img;
  const out = new Float64Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = Math.floor(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] + 0.5);
  }
  return out;
}

/**
 * Area-weighted box filter down to DCT_N x DCT_N (SPEC.md 5.1 step 3).
 *
 * Implemented here rather than delegated to canvas/sharp on purpose: resampler
 * differences are the number one cause of cross-platform hash drift, and box is
 * chosen over bilinear/Lanczos because its weights are exact ratios of pixel
 * overlap with no kernel constants to disagree about.
 */
function resizeBox(src: Float64Array, width: number, height: number): Float64Array {
  const N = DCT_N;
  const out = new Float64Array(N * N);
  const sy = height / N;
  const sx = width / N;

  for (let oy = 0; oy < N; oy++) {
    const y0 = oy * sy;
    const y1 = y0 + sy;
    const yStart = Math.floor(y0);
    const yEnd = Math.min(height, Math.ceil(y1));

    for (let ox = 0; ox < N; ox++) {
      const x0 = ox * sx;
      const x1 = x0 + sx;
      const xStart = Math.floor(x0);
      const xEnd = Math.min(width, Math.ceil(x1));

      let acc = 0;
      let wsum = 0;
      // Fixed iteration order: summation order changes the rounding, so it is
      // part of the specification, not an implementation detail.
      for (let y = yStart; y < yEnd; y++) {
        const wy = Math.min(y1, y + 1) - Math.max(y0, y);
        if (wy <= 0) continue;
        const row = y * width;
        for (let x = xStart; x < xEnd; x++) {
          const wx = Math.min(x1, x + 1) - Math.max(x0, x);
          if (wx <= 0) continue;
          const w = wy * wx;
          acc += src[row + x] * w;
          wsum += w;
        }
      }
      out[oy * N + ox] = wsum > 0 ? acc / wsum : 0;
    }
  }
  return out;
}

/** Separable DCT-II, keeping only the top-left DCT_K x DCT_K block. */
function dct8x8(g: Float64Array): Float64Array {
  const N = DCT_N;
  const K = DCT_K;
  const rows = new Float64Array(N * K);

  for (let y = 0; y < N; y++) {
    const off = y * N;
    for (let k = 0; k < K; k++) {
      const b = DCT_BASIS[k];
      let s = 0;
      for (let x = 0; x < N; x++) s += b[x] * g[off + x];
      rows[y * K + k] = s;
    }
  }

  const out = new Float64Array(K * K);
  for (let ky = 0; ky < K; ky++) {
    const b = DCT_BASIS[ky];
    for (let kx = 0; kx < K; kx++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += b[y] * rows[y * K + kx];
      out[ky * K + kx] = s;
    }
  }
  return out;
}

/**
 * Compute the 64-bit fingerprint.
 *
 * Bit order is part of the format: the 63 retained coefficients are read in
 * row-major order skipping the DC term at [0][0], most significant bit first,
 * then one trailing zero pads the value to 64 bits.
 */
export function fingerprint(img: RGBAImage): bigint {
  const { width, height } = img;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`invalid dimensions ${width}x${height}`);
  }
  if (img.data.length !== width * height * 4) {
    throw new Error(`expected ${width * height * 4} bytes of RGBA, got ${img.data.length}`);
  }

  const coeffs = dct8x8(resizeBox(toLuma(img), width, height));

  // Median of the 63 AC coefficients. The DC term carries overall brightness,
  // which is exactly the thing a perceptual hash must ignore.
  const ac = new Float64Array(63);
  for (let i = 1; i < 64; i++) ac[i - 1] = coeffs[i];
  const sorted = Float64Array.from(ac).sort();
  const median = sorted[31];

  let hash = 0n;
  for (let i = 0; i < 63; i++) hash = (hash << 1n) | (ac[i] > median ? 1n : 0n);
  return hash << 1n;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let d = 0;
  while (x) {
    x &= x - 1n;
    d++;
  }
  return d;
}

/**
 * Split into the 8 LSH bands the index is keyed by (SPEC.md 6.3).
 * Band 0 is the most significant byte.
 */
export function toBands(fp: bigint): number[] {
  const bands: number[] = [];
  for (let i = 7; i >= 0; i--) bands.push(Number((fp >> BigInt(i * 8)) & 0xffn));
  return bands;
}
