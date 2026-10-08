// The WASM-only build. The default entry point includes WebGPU and ships a
// 22 MB runtime; the WASM backend this module uses needs the 11 MB one.
import * as ort from 'onnxruntime-web/wasm';
import { BCH, BCH_Encode, BCH_Decode } from './bch.js';

/**
 * TrustMark, in the browser.
 *
 * Adobe's official JavaScript build only decodes, so registration originally
 * needed a server running the Rust crate -- and that server needs about 1 GB
 * to hold the models, which no free host offers any more. This module runs both
 * directions with onnxruntime-web instead, using Adobe's own models (MIT),
 * served by this app. No server does the work, and the image never leaves the
 * person's device.
 *
 * Ported from the Rust crate (adobe/trustmark, rust/src) and checked against
 * it: images this module encodes decode with the Rust CLI, and images the Rust
 * CLI encoded decode here.
 */

/**
 * Served from the app's own origin (public/models, placed by
 * scripts/fetch-web-models.sh). Adobe's CDN works but was slow enough to serve
 * the 45 MB decoder that real-browser requests failed part-way -- and a failed
 * response carries no CORS header, so the browser reported it as a CORS block.
 */
const MODEL_BASE = process.env.NEXT_PUBLIC_TRUSTMARK_MODELS ?? '/models/';
const SIZE = 256; // TrustMark Q works at 256x256 regardless of the input size

/** Raw RGBA, row-major. Matches grain-core's RGBAImage. */
export interface RGBA { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

export type ModelBytes = { encoder?: Uint8Array; decoder?: Uint8Array; resizer?: Uint8Array };

// ---------------------------------------------------------------- schema --

/**
 * The 100-bit payload: data, BCH parity, then a version tag in the last bits.
 * The tag says which row applies, so decoding reads it rather than assuming.
 * That matters: Adobe's CLI defaults to BCH_5 despite its help text saying
 * BCH_SUPER, and a decoder that assumed one scheme silently missed the other.
 */
const SCHEMAS = [
  { name: 'BCH_SUPER', dataBits: 40, t: 8, tag: [0, 0, 0, 0] },
  { name: 'BCH_5', dataBits: 61, t: 5, tag: [0, 0, 0, 1] },
  { name: 'BCH_4', dataBits: 68, t: 4, tag: [0, 0, 1, 0] },
  { name: 'BCH_3', dataBits: 75, t: 3, tag: [0, 0, 1, 1] },
] as const;
const POLYNOMIAL = 137;
const engines = SCHEMAS.map((s) => BCH(s.t, POLYNOMIAL));

/**
 * WE ENCODE BCH_5, NOT BCH_SUPER, and the reason is interoperability.
 *
 * Adobe ships three TrustMark implementations and they do not agree on
 * BCH_SUPER. Checked against Adobe's own Python reference (trustmark 0.9.2,
 * datalayer.py and bchecc.py), Adobe's JS library produces identical parity,
 * but the Rust crate (0.2.2) does not, for two reasons:
 *
 *  - padding: Python adds no padding when the data is a whole number of bytes;
 *    the Rust port adds `8 - bits % 8` zeros, a full extra byte for 40 bits
 *  - parity: Python's leftover-byte loop steps through the table (`pidx += 1`);
 *    the Rust port reuses the same entry for every word
 *
 * Both only matter when data leaves bytes over after whole 32-bit words, which
 * BCH_SUPER's 40 bits do and BCH_5's 61 bits (8 bytes) do not. So a BCH_SUPER
 * mark is readable by Python and JS but not by the Rust crate, and vice versa,
 * while BCH_5 reads identically everywhere. A soft binding only one decoder can
 * read is not much of a soft binding.
 *
 * The cost is correcting 5 bit flips instead of 8. The robustness matrix in
 * docs/ROBUSTNESS.md was measured with BCH_5, so its numbers describe exactly
 * what ships. A 40-bit recordId sits in the leading bits of BCH_5's 61.
 */
const ENCODE_SCHEMA = 1;
const RECORD_ID_BITS = 40;

function payload(recordId: bigint): Float32Array {
  const sc = SCHEMAS[ENCODE_SCHEMA];
  if (recordId <= 0n || recordId >= 1n << BigInt(RECORD_ID_BITS)) {
    throw new Error(`recordId ${recordId} does not fit in ${RECORD_ID_BITS} bits`);
  }
  // The recordId leads; the rest of the schema's data bits are zero, which is
  // also what the reference produces for a short binary payload.
  const data = recordId.toString(2).padStart(RECORD_ID_BITS, '0').padEnd(sc.dataBits, '0')
    .split('').map((c) => c === '1');
  const parity = BCH_Encode(engines[ENCODE_SCHEMA], data)
    .flatMap((b) => b.toString(2).padStart(8, '0').split(''))
    .slice(0, 96 - sc.dataBits)
    .map((c) => c === '1');
  return Float32Array.from([...data, ...parity, ...sc.tag.map(Boolean)], (b) => (b ? 1 : 0));
}

function readPayload(bits: boolean[]): { recordId: bigint; schema: string; corrected: number } | null {
  const named = (bits[98] ? 2 : 0) + (bits[99] ? 1 : 0);
  // Try the scheme the tag names first, then the rest -- the tag itself can be
  // a flipped bit.
  for (const i of [named, ...[0, 1, 2, 3].filter((x) => x !== named)]) {
    const sc = SCHEMAS[i];
    const r = BCH_Decode(engines[i], bits.slice(0, sc.dataBits), bits.slice(sc.dataBits, 96));
    if (r.valid && r.data_binary) {
      // A Grain mark carries its recordId in the leading 40 bits and zeros after.
      // Anything else is someone else's TrustMark payload, which is not ours to
      // interpret as a registry id.
      if (/1/.test(r.data_binary.slice(RECORD_ID_BITS))) return null;
      const id = BigInt('0b' + r.data_binary.slice(0, RECORD_ID_BITS));
      if (id === 0n) return null; // 0 is the null recordId
      return { recordId: id, schema: sc.name, corrected: r.bitflips };
    }
  }
  return null;
}

// --------------------------------------------------------------- models --

let wasmConfigured = false;
function configureWasm() {
  if (wasmConfigured) return;
  wasmConfigured = true;
  if (typeof window !== 'undefined') {
    // Same-origin, like the models: a third-party CDN reset this download
    // mid-transfer in testing, and the runtime is useless half-loaded.
    ort.env.wasm.wasmPaths = '/ort/';
    // Threads need cross-origin isolation; without it, one thread is all there is.
    ort.env.wasm.numThreads = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated
      ? Math.min(4, navigator.hardwareConcurrency || 1)
      : 1;
  } else {
    ort.env.wasm.numThreads = 1;
  }
}

/**
 * 'basic' graph optimisation, measured: full optimisation took 60s to create
 * the encoder session; 'basic' takes 0.3s for the same inference speed.
 */
const SESSION_OPTS: ort.InferenceSession.SessionOptions = {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'basic',
};

const sessions: Partial<Record<'encoder' | 'decoder' | 'resizer', Promise<ort.InferenceSession>>> = {};
let local: ModelBytes = {};

/** For tests and offline use: supply model bytes instead of fetching them. */
export function useModelBytes(bytes: ModelBytes) { local = bytes; }

const ready = new Set<string>();

/**
 * Model bytes, kept in Cache Storage across visits.
 *
 * The HTTP cache is not enough: Chromium declines to store a 45 MB response,
 * immutable header or not, so without this every visit re-downloaded the
 * decoder. Cache Storage has no per-entry limit. The file names carry no
 * version, so the cache name does: bump it when the models change.
 */
const MODEL_CACHE = 'grain-models-v1';

async function modelBytes(url: string): Promise<Uint8Array> {
  let cache: Cache | undefined;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch { /* no Cache Storage (private mode, insecure origin): just fetch */ }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url}: ${res.status}`);
  if (cache) await cache.put(url, res.clone()).catch(() => {});
  return new Uint8Array(await res.arrayBuffer());
}

function session(name: 'encoder' | 'decoder' | 'resizer'): Promise<ort.InferenceSession> {
  configureWasm();
  const file = name === 'resizer' ? 'resizer.onnx' : `${name}_Q.onnx`;
  sessions[name] ??= (local[name] ? Promise.resolve(local[name]!) : modelBytes(`${MODEL_BASE}${file}`))
    .then((bytes) => ort.InferenceSession.create(bytes as never, SESSION_OPTS))
    .then((s) => { ready.add(name); return s; });
  // A failed load must not stick: let the next call try again.
  sessions[name]!.catch(() => { delete sessions[name]; });
  return sessions[name]!;
}

/**
 * Whether watermark decoding can answer right now. On a first visit the 45 MB
 * decoder may still be downloading, and the fingerprint path should not wait
 * for it -- see resolveProgressive.
 */
export function decoderReady(): boolean {
  return ready.has('decoder') && ready.has('resizer');
}

/**
 * Start downloading in the background before it is needed. The decoder is
 * 45 MB and the encoder 17 MB; fetching on page load means the cost lands
 * while the person is still choosing an image.
 */
export function prefetch(which: 'verify' | 'register') {
  void session('resizer');
  void session(which === 'verify' ? 'decoder' : 'encoder');
}

// --------------------------------------------------------------- pixels --

/** RGBA -> CHW float in [0,1]. */
function toCHW(img: RGBA): Float32Array {
  const P = img.width * img.height;
  const t = new Float32Array(3 * P);
  for (let i = 0; i < P; i++) {
    t[i] = img.data[i * 4] / 255;
    t[P + i] = img.data[i * 4 + 1] / 255;
    t[2 * P + i] = img.data[i * 4 + 2] / 255;
  }
  return t;
}

/** The scale the ONNX resizer needs to land on exactly `target` -- Adobe's search. */
function exactScale(orig: number, target: number): number {
  let lo = target / orig, hi = (target + 1) / orig, s = lo;
  for (let i = 0; i < 100; i++) {
    s = (lo + hi) / 2;
    const a = Math.floor(orig * s + 1e-12);
    if (a < target) lo = s; else if (a > target) hi = s; else break;
  }
  return s;
}

/**
 * Antialiased downscale to 256x256 via Adobe's resizer model, returned in
 * [-1,1] -- the range the Rust crate feeds both models. The antialiasing
 * matters: the mark lives in exactly the frequencies a naive resize aliases.
 */
async function toModelInput(img: RGBA): Promise<Float32Array> {
  const resizer = await session('resizer');
  const out = await resizer.run({
    X: new ort.Tensor('float32', toCHW(img), [1, 3, img.height, img.width]),
    scales: new ort.Tensor('float32',
      new Float32Array([1, 1, exactScale(img.height, SIZE), exactScale(img.width, SIZE)]), [4]),
    target_size: new ort.Tensor('int64', new BigInt64Array([BigInt(SIZE)]), [1]),
  });
  const small = Object.values(out)[0].data as Float32Array;
  return Float32Array.from(small, (v) => v * 2 - 1);
}

/** Bilinear upsample of one 256x256 plane to WxH, pixel-centre aligned. */
function upsample(plane: Float32Array, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  const sx = SIZE / W, sy = SIZE / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(SIZE - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(SIZE - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(SIZE - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(SIZE - 1, x0 + 1), wx = fx - x0;
      const top = plane[y0 * SIZE + x0] * (1 - wx) + plane[y0 * SIZE + x1] * wx;
      const bot = plane[y1 * SIZE + x0] * (1 - wx) + plane[y1 * SIZE + x1] * wx;
      out[y * W + x] = top * (1 - wy) + bot * wy;
    }
  }
  return out;
}

// ---------------------------------------------------------------- public --

/**
 * The Rust crate centre-crops images past 2:1 and then needs a separate pass
 * to clean up the residual's edges. SPEC 5.2 already says to lean on the
 * fingerprint for those shapes, so rather than port the edge-case code they are
 * simply not watermarked -- and the manifest records that honestly.
 */
export function canWatermark(img: RGBA): boolean {
  const r = img.width / img.height;
  return r >= 0.5 && r <= 2.0;
}

/** WM_STRENGTH. The crate documents 0.95 as normal. */
export const DEFAULT_STRENGTH = 0.95;
/** The residual is clamped to this in [-1,1] space: at most ±10% of any pixel. */
const RESIDUAL_LIMIT = 0.2;

export async function encodeWatermark(img: RGBA, recordId: bigint, strength = DEFAULT_STRENGTH): Promise<RGBA> {
  if (!canWatermark(img)) throw new Error('aspect ratio past 2:1; not watermarkable');

  const [encoder, input] = await Promise.all([session('encoder'), toModelInput(img)]);
  const out = await encoder.run({
    'onnx::Concat_0': new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]),
    'onnx::Gemm_1': new ort.Tensor('float32', payload(recordId), [1, 100]),
  });
  const marked = out.image.data as Float32Array;

  const { width: W, height: H } = img;
  const N = SIZE * SIZE;
  const result = new Uint8ClampedArray(img.data.length);
  for (let c = 0; c < 3; c++) {
    const plane = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = strength * (marked[c * N + i] - input[c * N + i]);
      plane[i] = Math.max(-RESIDUAL_LIMIT, Math.min(RESIDUAL_LIMIT, r));
    }
    const full = upsample(plane, W, H);
    // apply_residual in the crate: x = 2p-1, then (min(x + r, 1) + 1) / 2,
    // i.e. p + r/2, capped at white; the floor at black comes from the 8-bit
    // conversion, as it does in the crate.
    for (let i = 0; i < W * H; i++) {
      const p = img.data[i * 4 + c] / 255;
      result[i * 4 + c] = Math.round(Math.max(0, Math.min(1, p + full[i] / 2)) * 255);
    }
  }
  for (let i = 0; i < W * H; i++) result[i * 4 + 3] = img.data[i * 4 + 3];
  return { data: result, width: W, height: H };
}

export interface DecodedMark { recordId: bigint; schema: string; corrected: number }

/** Null is the normal case: most images carry no watermark at all. */
export async function decodeWatermark(img: RGBA): Promise<DecodedMark | null> {
  try {
    const [decoder, input] = await Promise.all([session('decoder'), toModelInput(img)]);
    const out = await decoder.run({ image: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
    const bits = Array.from(out.output.data as Float32Array, (v) => v >= 0);
    return readPayload(bits);
  } catch (e) {
    console.warn('[trustmark] decode failed', e);
    return null;
  }
}
