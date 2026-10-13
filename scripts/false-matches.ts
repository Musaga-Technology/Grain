/**
 * How often do *different* images get the same fingerprint?
 *
 * Two populations: real photographs (every pair in the corpus from
 * scripts/fetch-corpus.ts), and procedural art -- smooth gradients and ridges
 * -- with the same layout and different seeds, the hard case for any
 * perceptual hash. Reports each pair's distance against Grain's thresholds:
 * <= 7 is credited on the fingerprint alone, 8-16 is UNCERTAIN.
 *
 *   for sc in dusk night sea meadow aurora; do for s in $(seq 1 20); do
 *     node --experimental-strip-types scripts/make-sample-art.ts art/$sc-$s.png $sc $((s*7919)); done; done
 *   node --experimental-strip-types scripts/false-matches.ts art .corpus
 */
import { readFileSync, readdirSync } from 'node:fs';
import { decodeImage } from '../packages/grain-core/src/decode.ts';
import { fingerprint, hammingDistance } from '../packages/grain-core/src/fingerprint.ts';
const [artDir, corpusDir] = process.argv.slice(2);
const hist = (ds: number[]) => { const b = { '<=7': 0, '8-16': 0, '>16': 0 }; for (const d of ds) b[d <= 7 ? '<=7' : d <= 16 ? '8-16' : '>16']++; return b; };
// 1. procedural art: same scene, different seeds; and across scenes
const art = readdirSync(artDir).filter((f) => f.endsWith('.png')).map((f) => ({ f, scene: f.split('-')[0], fp: fingerprint(decodeImage(readFileSync(`${artDir}/${f}`))) }));
const same: number[] = [], cross: number[] = [];
for (let i = 0; i < art.length; i++) for (let j = i + 1; j < art.length; j++) (art[i].scene === art[j].scene ? same : cross).push(hammingDistance(art[i].fp, art[j].fp));
console.log('procedural, same scene, different seed:', same.length, 'pairs', hist(same), 'min', Math.min(...same));
for (const sc of ['dusk', 'night', 'sea', 'meadow', 'aurora']) { const a = art.filter((x) => x.scene === sc); const d: number[] = []; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) d.push(hammingDistance(a[i].fp, a[j].fp)); console.log('  ', sc.padEnd(7), hist(d), 'median', d.sort((x, y) => x - y)[d.length >> 1]); }
console.log('procedural, different scenes:', cross.length, 'pairs', hist(cross), 'min', Math.min(...cross));
// 2. real photo corpus, all pairs
const files = readdirSync(corpusDir).filter((f) => /\.jpe?g$/i.test(f));
const fps: { f: string; fp: bigint; w: number; h: number }[] = [];
for (const f of files) { try { const img = decodeImage(readFileSync(`${corpusDir}/${f}`)); fps.push({ f, fp: fingerprint(img), w: img.width, h: img.height }); } catch {} }
const all: number[] = []; const close: [number, string, string][] = [];
for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) { const d = hammingDistance(fps[i].fp, fps[j].fp); all.push(d); if (d <= 7) close.push([d, fps[i].f, fps[j].f]); }
all.sort((a, b) => a - b);
console.log('corpus:', fps.length, 'images,', all.length, 'pairs', hist(all), 'min', all[0], 'p0.1%', all[Math.floor(all.length * 0.001)], 'median', all[all.length >> 1]);
console.log('closest corpus pairs:', close.sort((a, b) => a[0] - b[0]).slice(0, 15));
