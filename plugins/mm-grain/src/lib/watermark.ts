/**
 * TrustMark watermarks for the CLI: decoding to check images, encoding to register them.
 *
 * This is the website's own browser port (apps/web/app/lib/trustmark), run on
 * onnxruntime-web's WASM backend, which also works in Node -- so the CLI reads
 * marks bit-for-bit as the site does, on any platform, with no native build.
 *
 * The models (45 MB decoder, 17 MB encoder) are too large to ship in an npm
 * package, so each is fetched from the Grain site on first use and cached on disk.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decodeWatermark, encodeWatermark, useModelBytes } from '../../../../apps/web/app/lib/trustmark/index.ts';
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

// useModelBytes replaces the whole set, so keep every model loaded so far.
const bytes: { encoder?: Uint8Array; decoder?: Uint8Array; resizer?: Uint8Array } = {};
const pending: Partial<Record<'encoder' | 'decoder', Promise<void>>> = {};

function load(which: 'encoder' | 'decoder', onDownload?: (file: string, mb: number) => void): Promise<void> {
  return (pending[which] ??= Promise.all([model(`${which}_Q.onnx`, onDownload), model('resizer.onnx', onDownload)])
    .then(([m, resizer]) => { bytes[which] = m; bytes.resizer = resizer; useModelBytes({ ...bytes }); }));
}

/** The 45 MB decoder: for checking images. */
export const loadDecoder = (onDownload?: (file: string, mb: number) => void) => load('decoder', onDownload);
/** The 17 MB encoder: for registering images. */
export const loadEncoder = (onDownload?: (file: string, mb: number) => void) => load('encoder', onDownload);

export { decodeWatermark, encodeWatermark };
