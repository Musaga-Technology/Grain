/**
 * Abstract compositions -- large overlapping shapes with fine texture -- for
 * demo registrations. Their low-frequency layout varies far more from seed to
 * seed than the landscapes in make-sample-art.ts, so their fingerprints stay
 * well apart from every image already registered.
 *
 *   node --experimental-strip-types scripts/make-abstract-art.ts <out.png> [seed]
 */
import { writeFileSync } from 'node:fs';
import { encodePNG } from '../packages/grain-core/src/png-encode.ts';

const [, , out = 'abstract.png', seedArg = '1'] = process.argv;
const W = 1200, H = 800;
let seed = Number(seedArg) >>> 0 || 1;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const palettes = [
  [[236, 226, 208], [31, 95, 79], [200, 52, 31], [233, 180, 76], [22, 21, 26]],
  [[244, 239, 230], [64, 87, 166], [227, 120, 90], [120, 170, 150], [40, 40, 60]],
  [[250, 246, 238], [140, 60, 120], [240, 190, 70], [60, 130, 140], [30, 30, 30]],
];
const pal = palettes[Math.floor(rand() * palettes.length)];
const data = new Uint8Array(W * H * 4);
const bg = pal[0];
for (let i = 0; i < W * H; i++) { data.set([bg[0], bg[1], bg[2], 255], i * 4); }
const shapes = 6 + Math.floor(rand() * 5);
for (let s = 0; s < shapes; s++) {
  const c = pal[1 + Math.floor(rand() * (pal.length - 1))];
  const cx = rand() * W, cy = rand() * H, r = 80 + rand() * 320, kind = rand();
  const w = 120 + rand() * 500, h = 80 + rand() * 400, alpha = 0.55 + rand() * 0.4;
  for (let y = Math.max(0, Math.floor(cy - Math.max(r, h))); y < Math.min(H, cy + Math.max(r, h)); y++) {
    for (let x = Math.max(0, Math.floor(cx - Math.max(r, w))); x < Math.min(W, cx + Math.max(r, w)); x++) {
      const inside = kind < 0.5 ? (x - cx) ** 2 + (y - cy) ** 2 < r * r : Math.abs(x - cx) < w / 2 && Math.abs(y - cy) < h / 2;
      if (!inside) continue;
      const i = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) data[i + k] = data[i + k] * (1 - alpha) + c[k] * alpha;
    }
  }
}
// Fine grain, so a watermark has texture to hide in.
for (let i = 0; i < W * H; i++) { const n = (rand() - 0.5) * 18; for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.max(0, Math.min(255, data[i * 4 + k] + n)); }
writeFileSync(out, encodePNG({ width: W, height: H, data }));
