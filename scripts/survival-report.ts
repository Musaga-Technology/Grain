/**
 * Does provenance survive the platforms people actually use?
 *
 * Takes a folder of copies downloaded back from X, WhatsApp, Telegram,
 * Instagram... and checks each one exactly as the website does: watermark,
 * fingerprint, the anti-forgery cross-check, and the distance the contract
 * itself computes. Writes a Markdown table and the raw JSON to docs/evidence.
 *
 * Name files <platform>-<anything>.<ext>, e.g. x-dusk.jpg, whatsapp-dusk.jpg.
 *
 *   plugins/mm-grain/node_modules/.bin/esbuild scripts/survival-report.ts --bundle \
 *     --platform=node --format=esm --alias:onnxruntime-web/wasm=onnxruntime-web \
 *     --external:onnxruntime-web --outfile=plugins/mm-grain/.survival.mjs
 *   node plugins/mm-grain/.survival.mjs <folder> [expected record id]
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { decodeImage } from '../packages/grain-core/src/index.ts';
import { verifyImage } from '../plugins/mm-grain/src/lib/grain.ts';
import { decodeWatermark, loadDecoder } from '../plugins/mm-grain/src/lib/watermark.ts';
import { toResult } from '../plugins/mm-grain/src/lib/format.ts';

const [dir, expected] = process.argv.slice(2);
if (!dir) { console.error('usage: survival-report <folder> [expected record id]'); process.exit(1); }

await loadDecoder((f, mb) => console.error(`downloading ${f} (${mb.toFixed(0)} MB, once)`));
const files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
const rows = [];
for (const f of files) {
  const path = join(dir, f);
  const bytes = new Uint8Array(readFileSync(path));
  let width = 0, height = 0;
  try { const img = decodeImage(bytes); width = img.width; height = img.height; } catch { /* reported below */ }
  try {
    const r = toResult(await verifyImage(bytes, decodeWatermark));
    const right = expected ? r.record?.recordId === expected : null;
    rows.push({ file: f, platform: basename(f, extname(f)).split('-')[0], kb: Math.round(statSync(path).size / 1024), size: `${width}×${height}`,
      state: r.state, watermark: r.watermark, distance: r.distance, onChain: r.onChainDistance, record: r.record?.recordId ?? null, creator: r.record?.creatorHandle ?? null, right });
  } catch (e) {
    rows.push({ file: f, platform: basename(f, extname(f)).split('-')[0], error: (e as Error).message });
  }
  const last = rows.at(-1)!;
  console.error(`${f}: ${'error' in last ? last.error : `${last.state} via ${last.watermark === 'found' ? 'watermark' : 'fingerprint'} → record ${last.record}`}`);
}

const verdict = (r: (typeof rows)[number]) => 'error' in r ? `couldn't read: ${r.error}`
  : r.state === 'RESOLVED' ? `✓ @${r.creator ?? '?'} (#${r.record})` : r.state === 'UNCERTAIN' ? `~ probably @${r.creator} (#${r.record})`
  : r.state === 'TAMPERED' ? '✕ forged credential' : '✕ not found';
const md = [
  `# Does provenance survive real platforms?`, ``, `Measured ${new Date().toISOString().slice(0, 10)}${expected ? `, against record #${expected}` : ''}. Each copy was downloaded back from the platform and checked exactly as the website checks it.`, ``,
  `| Platform | File | Size | Watermark | Fingerprint distance | Contract's distance | Result |`, `|---|---|---|---|---|---|---|`,
  ...rows.map((r) => 'error' in r ? `| ${r.platform} | ${r.file} | | | | | ${verdict(r)} |`
    : `| ${r.platform} | ${r.file} (${r.kb} KB) | ${r.size} | ${r.watermark === 'found' ? 'survived' : 'stripped'} | ${r.distance ?? '—'} | ${r.onChain ?? '—'} | ${verdict(r)} |`),
  ``, `Resolved: ${rows.filter((r) => !('error' in r) && r.state === 'RESOLVED').length} of ${rows.length}.`,
].join('\n');
mkdirSync('docs/evidence', { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
writeFileSync(`docs/evidence/survival-${stamp}.md`, md + '\n');
writeFileSync(`docs/evidence/survival-${stamp}.json`, JSON.stringify(rows, null, 2) + '\n');
console.log(md);
