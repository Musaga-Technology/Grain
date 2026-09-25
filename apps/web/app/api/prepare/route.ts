/**
 * Reserve a recordId and watermark the image.
 *
 * A PROXY, DELIBERATELY. The work happens in the resolver because TrustMark's
 * decoder is 45 MB and its encoder 17 MB, and both must stay resident: a
 * serverless function reloads them per invocation, which is exactly the two
 * seconds the daemon exists to remove. One service owns TrustMark; this app
 * owns the interface.
 *
 * Keeping it as a same-origin route rather than calling the resolver from the
 * browser means the upload is not subject to the resolver's CORS surface and
 * the resolver URL can change without a client rebuild.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const resolver = process.env.RESOLVER_URL ?? process.env.NEXT_PUBLIC_RESOLVER_URL;
  if (!resolver) {
    return Response.json({ error: 'server not configured' }, { status: 500 });
  }

  const form = await req.formData();
  const file = form.get('image');
  if (!(file instanceof File)) {
    return Response.json({ error: 'expected an image' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'That image is too large. Try one under 25MB.' }, { status: 413 });
  }

  const upstream = new FormData();
  upstream.append('image', file);

  let res: Response;
  try {
    res = await fetch(`${resolver}/v1/embed`, { method: 'POST', body: upstream });
  } catch (e) {
    console.error('embed upstream unreachable', e);
    return Response.json({ error: "Grain couldn't prepare that image. Try again." }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('embed upstream failed', res.status, detail.slice(0, 300));
    return Response.json({ error: "Grain couldn't prepare that image. Try again." }, { status: 502 });
  }

  return new Response(res.body, {
    headers: {
      'content-type': 'image/png',
      // The reserved id rides along; the browser needs it to build the manifest.
      'x-grain-record-id': res.headers.get('x-grain-record-id') ?? '',
      'cache-control': 'no-store',
    },
  });
}
