import { execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * TrustMark decode, shelled out to the Rust CLI.
 *
 * The official JavaScript build is decode-only and the Rust crate is what
 * encodes, so the server owns both operations. Running the CLI rather than
 * binding the library keeps the resolver in TypeScript; the cost is a process
 * spawn per request, measured at about 1 second on a 1600px image.
 */
export interface WatermarkConfig {
  binary: string;
  models: string;
  timeoutMs?: number;
}

export async function decodeWatermark(
  image: Uint8Array,
  cfg: WatermarkConfig,
): Promise<bigint | null> {
  const dir = await mkdtemp(join(tmpdir(), 'grain-wm-'));
  const path = join(dir, 'asset.png');
  try {
    await writeFile(path, image);
    const { stdout } = await run(cfg.binary, ['-m', cfg.models, 'decode', '-i', path],
      { timeout: cfg.timeoutMs ?? 20_000 });

    const match = stdout.match(/[01]{40,}/);
    if (!match) return null;

    // BCH_SUPER carries 40 data bits; the rest of the string is padding.
    const id = BigInt('0b' + match[0].slice(0, 40));
    return id === 0n ? null : id; // 0 is the null recordId
  } catch {
    // A failed decode is the normal case, not an error: most images carry no
    // watermark at all. The fingerprint path runs regardless.
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
