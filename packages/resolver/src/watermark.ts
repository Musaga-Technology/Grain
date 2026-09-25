import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
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

interface DaemonReply {
  ok: boolean;
  bits?: string | null;
  error?: string;
}

interface Pending {
  resolve: (reply: DaemonReply) => void;
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
        pending.resolve(JSON.parse(line) as DaemonReply);
      } catch (e) {
        pending.resolve({ ok: false, error: `unparseable reply: ${line.slice(0, 200)}` });
      }
    });

    proc.stderr.on('data', (b: Buffer) => process.stderr.write(`[trustmarkd] ${b}`));

    // If the daemon dies, fail everything queued and let the next request
    // restart it. A resolver that silently stops decoding watermarks would
    // look like the watermark path simply never matching.
    const die = () => {
      this.proc = null;
      for (const p of this.queue) { clearTimeout(p.timer); p.resolve({ ok: false, error: 'daemon exited' }); }
      this.queue = [];
    };
    proc.on('exit', die);
    proc.on('error', die);
  }

  request(payload: Record<string, unknown>, timeoutMs?: number): Promise<DaemonReply> {
    if (!this.proc) this.start();
    const proc = this.proc;
    if (!proc) return Promise.resolve({ ok: false, error: 'daemon unavailable' });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.queue.findIndex((p) => p.timer === timer);
        if (i >= 0) this.queue.splice(i, 1);
        resolve({ ok: false, error: 'timed out' });
      }, timeoutMs ?? this.cfg.timeoutMs ?? 20_000);

      this.queue.push({ resolve, reject, timer });
      proc.stdin.write(JSON.stringify(payload) + '\n');
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
    const reply = await daemon.request({ op: 'decode', path });
    if (!reply.ok) {
      console.warn('[watermark] decode failed:', reply.error);
      return null;
    }
    const bits = reply.bits;
    if (!bits) return null; // a miss, which is the normal case

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


/**
 * Embed a watermark, through the same resident process.
 *
 * Encoding lives here rather than in the web app because the model is 62 MB and
 * has to stay loaded: a serverless function would reload it per request, which
 * is the 2-second penalty this daemon exists to remove. One service owns
 * TrustMark; the web app owns the interface.
 */
export async function embedWatermark(
  image: Uint8Array,
  recordId: bigint,
  cfg: WatermarkConfig,
  strength = DEFAULT_STRENGTH,
): Promise<Uint8Array | null> {
  daemon ??= new Daemon(cfg);

  const dir = await mkdtemp(join(tmpdir(), 'grain-embed-'));
  const input = join(dir, 'in.png');
  const output = join(dir, 'out.png');
  try {
    await writeFile(input, image);
    // BCH_SUPER carries 40 data bits (docs/ROBUSTNESS.md).
    const bits = recordId.toString(2).padStart(40, '0');
    const reply = await daemon.request(
      { op: 'encode', path: input, out: output, bits, strength },
      60_000,
    );
    if (!reply.ok) {
      console.error('[watermark] embed failed:', reply.error);
      return null;
    }
    const marked = await readFile(output);
    if (marked.length === 0) {
      console.error('[watermark] embed produced an empty file');
      return null;
    }
    return new Uint8Array(marked);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * WM_STRENGTH. The crate documents 0.95 as normal. SPEC 5.2 wants this pinned
 * to the highest value with no visible ripple on the actual demo images, which
 * is a judgement by eye rather than a measurement -- it stays at the documented
 * default until someone has looked.
 */
export const DEFAULT_STRENGTH = 0.95;
