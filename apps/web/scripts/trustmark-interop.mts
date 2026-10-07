/**
 * Interoperability check for the browser TrustMark port.
 *
 * Encodes with the browser module and confirms the mark reads back both here
 * and with Adobe's Rust CLI -- a soft binding only one decoder can read is not
 * much of a soft binding. Needs the models and CLI from scripts/setup-trustmark.sh.
 *
 *   node --experimental-strip-types apps/web/scripts/trustmark-interop.mts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { useModelBytes, encodeWatermark, decodeWatermark } from '../app/lib/trustmark/index.ts';
import { decodeImage, encodePNG } from '../../../packages/grain-core/src/index.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const M = join(ROOT, '.tools', 'models');
const CLI = join(ROOT, '.tools', 'trustmark');
const RESIZER = join(ROOT, '.tools', 'models', 'resizer.onnx');

if (!existsSync(RESIZER)) {
  const res = await fetch('https://cai-watermark.adobe.net/watermarking/trustmark-models/resizer.onnx');
  writeFileSync(RESIZER, new Uint8Array(await res.arrayBuffer()));
}
useModelBytes({
  encoder: readFileSync(join(M, 'encoder_Q.onnx')),
  decoder: readFileSync(join(M, 'decoder_Q.onnx')),
  resizer: readFileSync(RESIZER),
});

let failures = 0;
for (const [fixture, id] of [['photo-02.png', 777n], ['photo-05.png', 1099511627775n], ['illustration-01.png', 42n]] as const) {
  const src = decodeImage(new Uint8Array(readFileSync(join(ROOT, 'fixtures', 'sources', fixture))));
  const marked = await encodeWatermark(src, id);
  const out = `/tmp/grain-interop-${fixture}`;
  writeFileSync(out, encodePNG(marked));

  const js = await decodeWatermark(marked);
  const raw = execFileSync(CLI, ['-m', M, 'decode', '-i', out], { encoding: 'utf8' }).match(/[01]{40,}/);
  const rust = raw ? BigInt('0b' + raw[0].slice(0, 40)) : null;

  const ok = js?.recordId === id && rust === id;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${fixture.padEnd(20)} wrote ${id}  browser read ${js?.recordId ?? 'nothing'}  rust read ${rust ?? 'nothing'}`);
}
process.exit(failures ? 1 : 0);
