/**
 * Milestone 0 robustness matrix.
 *
 * For each fixture: embed a watermark, take the WATERMARKED file as the
 * reference (SPEC.md §2 -- the anti-spoof check compares against the
 * watermark-bearing asset, and embedding already costs ~2 bits), then apply
 * each transform and record whether the watermark still decodes and how far
 * the fingerprint moved.
 *
 * Run: node --experimental-strip-types scripts/robustness-matrix.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeImage, encodePNG, encodeJPEG, fingerprint, hammingDistance,
  scale, cropFraction, gaussianBlur, socialFilter, fitWithin,
  MATCH_THRESHOLD, type RGBAImage,
} from '../packages/grain-core/src/index.ts';

const ROOT = join(import.meta.dirname, '..');
const TM = join(ROOT, '.tools', 'trustmark');
const MODELS = join(ROOT, '.tools', 'models');
const SRC = join(ROOT, 'fixtures', 'sources');
const WORK = '/tmp/grain-matrix';

type Out = { buf: Uint8Array; ext: string };
const png = (i: RGBAImage): Out => ({ buf: encodePNG(i), ext: 'png' });
const jpg = (i: RGBAImage, q: number): Out => ({ buf: encodeJPEG(i, q), ext: 'jpg' });

const TRANSFORMS: { name: string; apply: (i: RGBAImage) => Out }[] = [
  { name: 'none (control)',      apply: (i) => png(i) },
  // A screenshot of a displayed image is a lossless capture after the viewer
  // has scaled it to fit the screen.
  { name: 'screenshot',          apply: (i) => png(fitWithin(i, 1280)) },
  { name: 'JPEG Q40',            apply: (i) => jpg(i, 40) },
  { name: 'JPEG Q20',            apply: (i) => jpg(i, 20) },
  { name: 'downscale 50%',       apply: (i) => png(scale(i, 0.5)) },
  { name: 'downscale 25%',       apply: (i) => png(scale(i, 0.25)) },
  { name: 'crop 10%',            apply: (i) => png(cropFraction(i, 0.10)) },
  { name: 'crop 25%',            apply: (i) => png(cropFraction(i, 0.25)) },
  { name: 'social filter',       apply: (i) => png(socialFilter(i)) },
  { name: 'gaussian blur s=1.5', apply: (i) => png(gaussianBlur(i, 1.5)) },
  { name: 'screenshot+JPEG Q40', apply: (i) => jpg(fitWithin(i, 1280), 40) },
];

function tmEncode(input: string, output: string, recordId: number) {
  execFileSync(TM, ['-m', MODELS, 'encode', '-i', input, '-o', output,
    '-w', recordId.toString(2).padStart(40, '0')], { stdio: 'ignore' });
}

function tmDecode(path: string): bigint | null {
  try {
    const out = execFileSync(TM, ['-m', MODELS, 'decode', '-i', path], { encoding: 'utf8' });
    const m = out.match(/[01]{40,}/);
    return m ? BigInt('0b' + m[0].slice(0, 40)) : null;
  } catch {
    return null;
  }
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const fixtures = readdirSync(SRC).filter((f) => f.endsWith('.png')).sort();
const results: Record<string, { recovered: number; total: number; distances: number[] }> = {};
for (const t of TRANSFORMS) results[t.name] = { recovered: 0, total: 0, distances: [] };

const perFixture: any[] = [];
let embedShift: number[] = [];

console.log(`${fixtures.length} fixtures x ${TRANSFORMS.length} transforms\n`);

fixtures.forEach((name, idx) => {
  const recordId = idx + 1;
  const srcPath = join(SRC, name);
  const wmPath = join(WORK, `wm-${name}`);

  tmEncode(srcPath, wmPath, recordId);

  const original = decodeImage(readFileSync(srcPath));
  const watermarked = decodeImage(readFileSync(wmPath));
  const refFp = fingerprint(watermarked);
  const shift = hammingDistance(fingerprint(original), refFp);
  embedShift.push(shift);

  const row: any = { fixture: name, recordId, embedShift, transforms: {} };
  const cells: string[] = [];

  for (const t of TRANSFORMS) {
    const { buf, ext } = t.apply(watermarked);
    const p = join(WORK, `${name}.${t.name.replace(/[^a-z0-9]+/gi, '_')}.${ext}`);
    writeFileSync(p, buf);

    const got = tmDecode(p);
    const ok = got !== null && got === BigInt(recordId);
    const d = hammingDistance(refFp, fingerprint(decodeImage(readFileSync(p))));

    const r = results[t.name];
    r.total++;
    if (ok) r.recovered++;
    r.distances.push(d);
    row.transforms[t.name] = { watermark: ok, distance: d };
    cells.push(`${ok ? 'W' : '.'}${d}`);
  }

  perFixture.push(row);
  console.log(`${name.padEnd(20)} embed+${shift}  ${cells.join(' ')}`);
});

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

console.log('\n' + '='.repeat(78));
console.log('Transformation           WM recovery   FP dist (median / max)   Resolves?');
console.log('='.repeat(78));
const summary: any[] = [];
for (const t of TRANSFORMS) {
  const r = results[t.name];
  const med = median(r.distances);
  const max = Math.max(...r.distances);
  const rate = r.recovered / r.total;
  const fpOk = r.distances.filter((d) => d <= MATCH_THRESHOLD).length / r.distances.length;
  const resolves = Math.max(rate, fpOk);
  console.log(
    t.name.padEnd(24) +
    `${(rate * 100).toFixed(0).padStart(3)}%`.padEnd(14) +
    `${String(med).padStart(3)} / ${String(max).padStart(3)}`.padEnd(25) +
    `${(resolves * 100).toFixed(0)}%`
  );
  summary.push({ transform: t.name, watermarkRecovery: rate, medianDistance: med, maxDistance: max,
                 fingerprintWithinThreshold: fpOk, resolves });
}
console.log('='.repeat(78));
console.log(`\nembed shift: median ${median(embedShift)}, max ${Math.max(...embedShift)} (of ${MATCH_THRESHOLD} budget)`);

writeFileSync(join(ROOT, 'fixtures', 'robustness-results.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), matchThreshold: MATCH_THRESHOLD,
                   embedShift: { median: median(embedShift), max: Math.max(...embedShift) },
                   summary, perFixture }, null, 2) + '\n');
console.log('\nwrote fixtures/robustness-results.json');
