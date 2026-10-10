import { FetchRefused, fetchPublicImage } from '../../lib/fetch-public';

/**
 * Fetches a public image by URL, for "check this image" from a link or the
 * browser extension. Most sites don't send CORS headers, so the browser can't
 * read their images itself; this does it for them. The bytes go straight back
 * to the browser, which does the actual check, as it does for uploads. The
 * safeguards are in lib/fetch-public.
 */

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('url');
  if (!raw) return Response.json({ error: 'Missing ?url=' }, { status: 400 });
  try {
    const { bytes, type } = await fetchPublicImage(raw);
    return new Response(bytes as BlobPart, { headers: { 'content-type': type, 'cache-control': 'private, no-store' } });
  } catch (e) {
    const r = e instanceof FetchRefused ? e : new FetchRefused("Grain couldn't fetch that image.", 502);
    return Response.json({ error: r.message }, { status: r.status });
  }
}
