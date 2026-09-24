/**
 * Fetch a corpus of real photographs to seed the registry with.
 *
 * Lorem Picsum serves a fixed set of ~1,000 Unsplash photographs by id, which
 * makes it reproducible -- the same id always returns the same image, so a
 * re-run produces the same fingerprints.
 *
 * Only fingerprints ever reach the chain; the images are not redistributed and
 * are not committed. That is what makes the licensing question easy, and it
 * should be said plainly in the README.
 *
 * Run: node --experimental-strip-types scripts/fetch-corpus.ts [count] [outDir]
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const count = Number(process.argv[2] ?? 1000);
const outDir = process.argv[3] ?? join(import.meta.dirname, '..', '.corpus');
const CONCURRENCY = 8;

mkdirSync(outDir, { recursive: true });

let done = 0, skipped = 0, failed = 0;

async function fetchOne(id: number) {
  const path = join(outDir, `${id}.jpg`);
  if (existsSync(path)) { skipped++; return; }
  try {
    // 400x300 is plenty: the fingerprint resizes to 32x32 regardless, and
    // smaller images make the corpus fetch an order of magnitude faster.
    const res = await fetch(`https://picsum.photos/id/${id}/400/300`, { redirect: 'follow' });
    if (!res.ok) { failed++; return; }
    writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
    done++;
  } catch {
    failed++;
  }
}

const ids = Array.from({ length: count }, (_, i) => i);
for (let i = 0; i < ids.length; i += CONCURRENCY) {
  await Promise.all(ids.slice(i, i + CONCURRENCY).map(fetchOne));
  if ((i / CONCURRENCY) % 10 === 0) {
    process.stdout.write(`\r  fetched ${done}, skipped ${skipped}, failed ${failed}`);
  }
}
console.log(`\ndone: ${done} fetched, ${skipped} already present, ${failed} unavailable -> ${outDir}`);
