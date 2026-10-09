/**
 * Generates the artwork behind /verify's sample images.
 *
 * The samples need an image Grain can honestly say it made: registering a
 * stock photo under a Grain handle would be the misattribution the product
 * exists to catch. So the art is procedural -- a dusk landscape with layered
 * ridges, deterministic from a seed. Texture matters: a watermark hides in
 * detail and a fingerprint needs structure, so this avoids flat fills.
 *
 * Three scenes, chosen to be far apart as fingerprints so the samples cannot
 * be mistaken for one another: dusk (the registered one), night (the image a
 * forged mark is stamped onto), sea (never registered) and meadow (registered
 * with a licence price, for `mm grain license`).
 *
 *   node --experimental-strip-types scripts/make-sample-art.ts <out.png> <dusk|night|sea|meadow|aurora> [seed]
 */
import { writeFileSync } from 'node:fs';
import { encodePNG } from '../packages/grain-core/src/png-encode.ts';

const [, , out = 'sample.png', scene = 'dusk', seedArg = '7'] = process.argv;
const W = 1200, H = 800;
let seed = Number(seedArg) >>> 0;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// Smooth 1-D value noise for ridge lines.
function ridge(octaves: number, base: number) {
  const pts = Array.from({ length: 64 }, rand);
  const at = (x: number) => { const i = Math.floor(x) % 63; const f = x - Math.floor(x); const s = f * f * (3 - 2 * f); return pts[i] * (1 - s) + pts[i + 1] * s; };
  return (x: number) => { let v = 0, a = 1, fr = base, n = 0; for (let o = 0; o < octaves; o++) { v += a * at(x * fr); n += a; a *= 0.5; fr *= 2; } return v / n; };
}
const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

type Layer = { y: number; amp: number; color: number[]; f: (x: number) => number };
const SCENES: Record<string, { sky: number[][]; layers: Layer[]; sun: { x: number; y: number; r: number; color: number[] } }> = {
  dusk: {
    sky: [[24, 26, 64], [118, 64, 120], [244, 140, 96], [255, 214, 150]],
    layers: [
      { y: 0.52, amp: 0.20, color: [92, 60, 110], f: ridge(5, 0.006) },
      { y: 0.62, amp: 0.18, color: [62, 42, 88], f: ridge(5, 0.008) },
      { y: 0.74, amp: 0.14, color: [38, 30, 64], f: ridge(6, 0.011) },
      { y: 0.86, amp: 0.10, color: [20, 18, 40], f: ridge(6, 0.016) },
    ],
    sun: { x: W * (0.3 + rand() * 0.4), y: H * 0.46, r: 70, color: [255, 236, 200] },
  },
  // Dark above, pale dunes below: the luminance layout of dusk, inverted.
  night: {
    sky: [[6, 8, 22], [10, 16, 40], [22, 34, 70], [40, 58, 100]],
    layers: [
      { y: 0.30, amp: 0.10, color: [150, 160, 190], f: ridge(3, 0.004) },
      { y: 0.45, amp: 0.10, color: [196, 200, 220], f: ridge(3, 0.005) },
      { y: 0.62, amp: 0.08, color: [226, 226, 236], f: ridge(4, 0.007) },
    ],
    sun: { x: W * 0.8, y: H * 0.14, r: 40, color: [250, 250, 255] },
  },
  // A bright meadow under a high sun: light across the top two-thirds, the
  // inverse of dusk's dark sky. The licensable sample (see the README).
  meadow: {
    sky: [[120, 180, 235], [170, 210, 240], [215, 232, 245], [240, 245, 235]],
    layers: [
      { y: 0.50, amp: 0.10, color: [120, 170, 90], f: ridge(4, 0.004) },
      { y: 0.60, amp: 0.10, color: [70, 120, 55], f: ridge(5, 0.006) },
      { y: 0.72, amp: 0.08, color: [30, 70, 35], f: ridge(6, 0.02) },
    ],
    sun: { x: W * 0.22, y: H * 0.16, r: 50, color: [255, 252, 230] },
  },
  // Green light banded across a dark sky, black peaks below: bright in the
  // middle third, unlike every other scene. Registered by @grain-studio's
  // ERC-8004 agent (scripts/register-agent-sample.ts).
  aurora: {
    sky: [[4, 10, 24], [20, 120, 90], [90, 230, 160], [10, 30, 50]],
    layers: [
      { y: 0.72, amp: 0.16, color: [8, 12, 20], f: ridge(5, 0.009) },
      { y: 0.84, amp: 0.08, color: [3, 5, 9], f: ridge(6, 0.02) },
    ],
    sun: { x: W * 0.85, y: H * 0.12, r: 10, color: [240, 240, 255] },
  },
  // Bright sky top-left, a dark headland on the right, sea across the bottom.
  sea: {
    sky: [[210, 236, 245], [150, 210, 230], [80, 160, 190], [20, 90, 120]],
    layers: [
      { y: 0.70, amp: 0.02, color: [16, 70, 96], f: ridge(6, 0.05) },
      { y: 0.84, amp: 0.02, color: [10, 50, 72], f: ridge(6, 0.06) },
    ],
    sun: { x: W * 0.18, y: H * 0.2, r: 55, color: [255, 255, 240] },
  },
};
const sc = SCENES[scene];
if (!sc) throw new Error(`unknown scene ${scene}`);
const { sky, layers, sun } = sc;
const headland = scene === 'sea' || scene === 'aurora' ? ridge(5, 0.01) : null;
const data = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  const t = y / (H * 0.6);
  const seg = Math.min(2, Math.floor(t * 3));
  let c = lerp(sky[seg], sky[Math.min(3, seg + 1)], Math.min(1, t * 3 - seg));
  for (let x = 0; x < W; x++) {
    let px = c;
    const d = Math.hypot(x - sun.x, y - sun.y);
    if (d < sun.r) px = sun.color;
    else if (d < sun.r * 3) px = lerp(sun.color, px, Math.min(1, (d - sun.r) / (sun.r * 2)) ** 0.6);
    if (headland && scene === 'sea' && x > W * (0.55 + 0.1 * headland(y))) px = lerp([28, 40, 34], [12, 20, 16], y / H);
    // Aurora: a dark cliff on the left, so its layout mirrors no other scene.
    if (headland && scene === 'aurora' && x < W * (0.32 + 0.12 * headland(y))) px = lerp([6, 9, 14], [2, 3, 6], y / H);
    for (const L of layers) {
      const top = H * (L.y - L.amp * L.f(x));
      if (y > top) px = lerp(L.color, [L.color[0] * 0.6, L.color[1] * 0.6, L.color[2] * 0.6], Math.min(1, (y - top) / 220));
    }
    const grain = (rand() - 0.5) * 14; // film grain: texture for the watermark to sit in
    const i = (y * W + x) * 4;
    data[i] = Math.max(0, Math.min(255, px[0] + grain));
    data[i + 1] = Math.max(0, Math.min(255, px[1] + grain));
    data[i + 2] = Math.max(0, Math.min(255, px[2] + grain));
    data[i + 3] = 255;
  }
}
writeFileSync(out, encodePNG({ width: W, height: H, data }));
console.log(`wrote ${out}`);
