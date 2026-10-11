import { FetchRefused, fetchPublicImage } from '../../../lib/fetch-public';
import { checkImage } from '../../../lib/verify-server';

/**
 * Who made this image? One HTTP call, for any agent or service: no wallet, no
 * account, no SDK.
 *
 *   curl -X POST https://grain-on-monad.vercel.app/api/v1/verify --data-binary @photo.jpg
 *   curl "https://grain-on-monad.vercel.app/api/v1/verify?url=https://example.com/photo.jpg"
 *
 * It runs the same check as the website, the MCP server and `mm grain verify`
 * (lib/verify-server), so they cannot disagree about an image.
 * Every verdict carries the distance FingerprintIndex.verify() returned on
 * Monad, so the caller can check the answer without trusting this server.
 * The image is checked in memory and never stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD = 4 * 1024 * 1024; // Vercel's request body limit is 4.5 MB; larger images go by ?url=
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: CORS });
}

async function check(req: Request, bytes: Uint8Array) {
  const origin = new URL(req.url).origin;
  try {
    const result = await checkImage(bytes, origin);
    return Response.json(result, { headers: { ...CORS, 'cache-control': 'no-store' } });
  } catch (e) {
    const message = (e as Error).message ?? '';
    if (/decode|unsupported|not a (png|jpe?g)|invalid/i.test(message)) return fail('That is not a PNG or JPEG image Grain can read.', 415);
    console.error('verify failed', e);
    return fail('The check could not finish just now. Try again in a moment.', 503);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get('url');
  if (!url) {
    return Response.json({
      usage: 'POST an image (PNG or JPEG, up to 4 MB) as the request body, or GET ?url=<public image URL> (up to 15 MB).',
      returns: 'state (RESOLVED | UNCERTAIN | TAMPERED | NOT_FOUND), summary, record, matchedBy, distance, onChainDistance, fingerprint, watermark, candidatesFrom, madeWith',
      docs: 'https://github.com/Musaga-Technology/Grain#for-agents-one-http-call',
    }, { headers: CORS });
  }
  try {
    return await check(req, (await fetchPublicImage(url)).bytes);
  } catch (e) {
    if (e instanceof FetchRefused) return fail(e.message, e.status);
    throw e;
  }
}

export async function POST(req: Request) {
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  let bytes: Uint8Array;
  if (type === 'multipart/form-data') {
    const file = (await req.formData()).get('image');
    if (!(file instanceof Blob)) return fail('Send the image in a form field named "image".', 400);
    bytes = new Uint8Array(await file.arrayBuffer());
  } else if (type === 'application/json') {
    const { url } = (await req.json().catch(() => ({}))) as { url?: string };
    if (!url) return fail('Send {"url": "<image URL>"} or the image itself as the body.', 400);
    try { bytes = (await fetchPublicImage(url)).bytes; } catch (e) {
      if (e instanceof FetchRefused) return fail(e.message, e.status);
      throw e;
    }
  } else {
    bytes = new Uint8Array(await req.arrayBuffer());
  }
  if (bytes.length === 0) return fail('No image in the request.', 400);
  if (bytes.length > MAX_UPLOAD) return fail('Uploads are limited to 4 MB; pass larger images by ?url= instead.', 413);
  return check(req, bytes);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
