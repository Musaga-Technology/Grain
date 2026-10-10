import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Fetches a public image by URL, server side. It is a server that fetches URLs
 * on request, so it is locked down:
 * - http(s) only, and every hop -- redirects included -- must resolve to a
 *   public address, so it can't be pointed at anything internal (SSRF);
 * - images only, 15 MB at most, 10 seconds at most;
 * - nothing is stored or logged.
 */

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

/** A refusal whose message is safe and useful to show the caller. */
export class FetchRefused extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchRefused('Only http and https links can be checked.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => privateAddress(a.address))) throw new FetchRefused('That link points somewhere Grain cannot fetch from.');
}

export async function fetchPublicImage(raw: string): Promise<{ bytes: Uint8Array; type: string }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new FetchRefused("That isn't a link."); }
  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let res: Response | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublic(url);
      res = await fetch(url, {
        redirect: 'manual', signal,
        // Ask for formats Grain reads natively; many CDNs negotiate on this.
        headers: { accept: 'image/png,image/jpeg;q=0.9,image/*;q=0.5', 'user-agent': 'GrainImageCheck/1.0 (+https://grain-on-monad.vercel.app)' },
      });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!next) break;
      url = new URL(next, url);
      res = undefined;
    }
    if (!res) throw new FetchRefused('That link redirects too many times.');
    if (!res.ok) throw new FetchRefused(`The site answered ${res.status}.`, 502);

    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!type.startsWith('image/')) throw new FetchRefused("That link isn't an image.");
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new FetchRefused('That image is larger than 15 MB.');

    const reader = res.body?.getReader();
    if (!reader) throw new FetchRefused('The site sent nothing back.', 502);
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) { await reader.cancel(); throw new FetchRefused('That image is larger than 15 MB.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
    return { bytes, type };
  } catch (e) {
    if (e instanceof FetchRefused) throw e;
    throw new FetchRefused((e as Error).name === 'TimeoutError' ? 'That site took too long to answer.' : "Grain couldn't fetch that image.", 502);
  }
}
