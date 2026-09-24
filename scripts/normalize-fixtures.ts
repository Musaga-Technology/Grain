/**
 * Normalise the supplied images into a canonical fixture set.
 *
 * Why normalise at all: the sources are 520 KB screenshots through to 8640px
 * Unsplash originals, plus vector SVGs that cannot be watermarked. The matrix
 * needs one consistent starting point, and a realistic one -- a photographer
 * publishes a web-sized image, and that published copy is what gets screenshot,
 * cropped and re-encoded. So everything is fitted inside 1600px on the long
 * edge, flattened onto white, and written as PNG.
 *
 * SVGs are rasterised with qlmanage, which pads its output to a square. The
 * padding is cropped back to the content bounding box, or every illustration
 * fixture would carry artificial borders that are not in the artwork.
 *
 * Run: node --experimental-strip-types scripts/normalize-fixtures.ts <srcDir>
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import {
  decodeImage, decodePNG, encodePNG, fingerprint, fitWithin, flattenOnWhite,
  trimUniformBorder, aspectRatioWarning,
} from '../packages/grain-core/src/index.ts';

const MAX_EDGE = 1600;
const srcDir = process.argv[2] ?? '/Users/musaga/grain-kit/images';
const outDir = join(import.meta.dirname, '..', 'fixtures', 'sources');
const tmpDir = '/tmp/grain-svg-raster';

function categorise(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.svg') || n.startsWith('undraw')) return 'illustration';
  if (n.startsWith('screenshot')) return 'screenshot';
  if (n.includes('unsplash')) return 'photo';
  return 'other';
}

mkdirSync(outDir, { recursive: true });
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

const counters: Record<string, number> = {};
const manifest: any[] = [];

for (const name of readdirSync(srcDir).sort()) {
  const ext = extname(name).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.svg'].includes(ext)) continue;

  const category = categorise(name);
  let img;

  if (ext === '.svg') {
    execFileSync('qlmanage', ['-t', '-s', String(MAX_EDGE * 2), '-o', tmpDir, join(srcDir, name)],
      { stdio: 'ignore' });
    const produced = readdirSync(tmpDir).find((f) => f.startsWith(name));
    if (!produced) { console.warn(`  SKIP ${name}: qlmanage produced nothing`); continue; }
    // qlmanage pads to an opaque white square, so alpha-based bounds see
    // nothing; the padding has to be trimmed by colour.
    img = trimUniformBorder(decodePNG(readFileSync(join(tmpDir, produced))));
  } else {
    // Camera originals here run to 50 megapixels; this is trusted local input,
    // unlike anything the resolver decodes.
    img = decodeImage(readFileSync(join(srcDir, name)), { maxMemoryMB: 2048 });
  }

  const originalDims = `${img.width}x${img.height}`;
  img = flattenOnWhite(fitWithin(img, MAX_EDGE));

  counters[category] = (counters[category] ?? 0) + 1;
  const outName = `${category}-${String(counters[category]).padStart(2, '0')}.png`;
  writeFileSync(join(outDir, outName), encodePNG(img));

  const ratio = Math.max(img.width, img.height) / Math.min(img.width, img.height);
  const entry = {
    fixture: outName,
    category,
    source: name,
    rasterisedFrom: ext === '.svg' ? 'svg via qlmanage, padding cropped' : undefined,
    originalDimensions: originalDims,
    dimensions: `${img.width}x${img.height}`,
    aspectRatio: Number(ratio.toFixed(2)),
    exceedsTrustmarkRatio: aspectRatioWarning(img.width, img.height),
    fingerprint: '0x' + fingerprint(img).toString(16).padStart(16, '0'),
  };
  manifest.push(entry);
  console.log(
    `${outName.padEnd(20)} ${entry.dimensions.padEnd(11)} ratio ${String(entry.aspectRatio).padEnd(5)}` +
    `${entry.exceedsTrustmarkRatio ? ' >2:1' : '     '}  ${name}`
  );
}

writeFileSync(join(outDir, '..', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
rmSync(tmpDir, { recursive: true, force: true });

console.log('\nby category:', counters);
console.log(`${manifest.length} fixtures -> fixtures/sources/`);

const fps = new Set(manifest.map((m) => m.fingerprint));
if (fps.size !== manifest.length) console.warn('WARNING: duplicate fingerprints in the fixture set');
