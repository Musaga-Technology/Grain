import { readFile } from 'node:fs/promises';

const MAX_BYTES = 50 * 1024 * 1024;

/** A local path or an http(s) URL -- agents mostly hold the latter. */
export async function loadImage(source: string): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`could not fetch the image (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('the image is larger than 50 MB');
    return bytes;
  }
  return new Uint8Array(await readFile(source));
}
