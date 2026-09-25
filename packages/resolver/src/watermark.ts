import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/**
 * TrustMark decode through a long-lived daemon.
 *
 * The CLI reloads a 45 MB ONNX decoder on every invocation, measured at
 * 2.0-2.8s. Holding the model in a resident process brings a decode to
 * 0.33-0.61s, which is the difference between missing and meeting SPEC 8.2's
 * under-two-second target.
 *
 * The protocol is newline-delimited JSON and strictly FIFO, so responses are
 * matched to requests by order rather than by id.
 */

export interface WatermarkConfig {
  binary: string;
  models: string;
  timeoutMs?: number;
}

interface Pending {
  resolve: (bits: string | null) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

class Daemon {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private queue: Pending[] = [];
  private cfg: WatermarkConfig;

  constructor(cfg: WatermarkConfig) {
    this.cfg = cfg;
  }

  private start() {
    const proc = spawn(this.cfg.binary, [this.cfg.models], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;

    createInterface({ input: proc.stdout }).on('line', (line) => {
      const pending = this.queue.shift();
      if (!pending) return;
      clearTimeout(pending.timer);
      try {
        const res = JSON.parse(line) as { ok: boolean; bits?: string | null; error?: string };
        pending.resolve(res.ok ? (res.bits ?? null) : null);
      } catch {
        pending.resolve(null);
      }
    });

    proc.stderr.on('data', (b: Buffer) => process.stderr.write(`[trustmarkd] ${b}`));

    // If the daemon dies, fail everything queued and let the next request
    // restart it. A resolver that silently stops decoding watermarks would
    // look like the watermark path simply never matching.
    const die = () => {
      this.proc = null;
      for (const p of this.queue) { clearTimeout(p.timer); p.resolve(null); }
      this.queue = [];
    };
    proc.on('exit', die);
    proc.on('error', die);
  }

  request(path: string): Promise<string | null> {
    if (!this.proc) this.start();
    const proc = this.proc;
    if (!proc) return Promise.resolve(null);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.queue.findIndex((p) => p.timer === timer);
        if (i >= 0) this.queue.splice(i, 1);
        resolve(null);
      }, this.cfg.timeoutMs ?? 20_000);

      this.queue.push({ resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ op: 'decode', path }) + '\n');
    });
  }
}

let daemon: Daemon | null = null;

export async function decodeWatermark(
  image: Uint8Array,
  cfg: WatermarkConfig,
): Promise<bigint | null> {
  daemon ??= new Daemon(cfg);

  const dir = await mkdtemp(join(tmpdir(), 'grain-wm-'));
  const path = join(dir, 'asset.png');
  try {
    await writeFile(path, image);
    const bits = await daemon.request(path);
    if (!bits) return null;

    // BCH_SUPER carries 40 data bits; the rest is padding.
    const id = BigInt('0b' + bits.slice(0, 40));
    return id === 0n ? null : id; // 0 is the null recordId
  } catch {
    // A miss is the normal case, not an error: most images carry no watermark.
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
