/**
 * TrustMark watermark decoding for the CLI.
 *
 * This is the website's own browser port (apps/web/app/lib/trustmark), run on
 * onnxruntime-web's WASM backend, which also works in Node -- so the CLI reads
 * marks bit-for-bit as the site does, on any platform, with no native build.
 *
 * The decoder is 45 MB, too large to ship in an npm package, so it is fetched
 * from the Grain site on first use and cached on disk.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decodeWatermark, useModelBytes } from '../../../../apps/web/app/lib/trustmark/index.ts';
import { SITE } from './grain.ts';

const CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'grain', 'models');

async function model(file: string, onDownload?: (file: string, mb: number) => void): Promise<Uint8Array> {
  const path = join(CACHE, file);
  try {
    return new Uint8Array(await readFile(path));
  } catch { /* not cached yet */ }
  const res = await fetch(`${SITE}/models/${file}`);
  if (!res.ok) throw new Error(`could not download ${file} (${res.status})`);
  onDownload?.(file, Number(res.headers.get('content-length') ?? 0) / 1e6);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await mkdir(CACHE, { recursive: true });
  // Write then rename, so an interrupted download never leaves a truncated model.
  await writeFile(`${path}.part`, bytes);
  await rename(`${path}.part`, path);
  return bytes;
}

let loaded: Promise<void> | undefined;

export function loadDecoder(onDownload?: (file: string, mb: number) => void): Promise<void> {
  return (loaded ??= Promise.all([model('decoder_Q.onnx', onDownload), model('resizer.onnx', onDownload)])
    .then(([decoder, resizer]) => useModelBytes({ decoder, resizer })));
}

export { decodeWatermark };
