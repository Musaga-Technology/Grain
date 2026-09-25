import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFileSync } from 'node:fs';
import { decodeImage, fingerprint, resolve, MATCH_THRESHOLD, TAMPER_THRESHOLD } from '@grain/core';
import { Chain } from './chain.ts';
import { decodeWatermark, embedWatermark } from './watermark.ts';

/**
 * C2PA Soft Binding Resolution API (SPEC.md §7).
 *
 * The API shape follows a published specification rather than an invented
 * endpoint, so an existing C2PA client can point at Grain unmodified. That is
 * the strongest single line in the write-up, and it is worth keeping true.
 *
 * No auth, no rate-limit key, CORS open. It is a public good; treat it as one.
 * The decode memory ceiling is the one guard, because an open endpoint that
 * decodes whatever is posted at it is a free denial-of-service otherwise.
 */

const env = (k: string, fallback?: string) => process.env[k] ?? fallback ?? '';
const deployments = JSON.parse(readFileSync(env('GRAIN_DEPLOYMENTS', 'deployments/monad-testnet.json'), 'utf8'));

const chain = new Chain({
  rpcUrl: env('RPC_TESTNET_ENDPOINT'),
  registry: deployments.contracts.GrainRegistry,
  index: deployments.contracts.FingerprintIndex,
});

const wm = {
  binary: env('TRUSTMARKD_BIN', 'packages/trustmarkd/target/release/trustmarkd'),
  models: env('TRUSTMARK_MODELS', '.tools/models'),
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const app = new Hono();
app.use('*', cors());

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));

app.get('/health', async (c) => {
  try {
    const h = await chain.health();
    return c.json({
      ok: true,
      chainId: deployments.chainId,
      block: h.block.toString(),
      records: (h.nextRecordId - 1n).toString(),
      thresholds: { match: MATCH_THRESHOLD, tamper: TAMPER_THRESHOLD },
    });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 503);
  }
});

app.get('/v1/records/:id', async (c) => {
  const id = BigInt(c.req.param('id'));
  const record = await chain.record(id);
  if (!record) return c.json({ error: 'no such record' }, 404);
  return c.json(json({ record }));
});

/** Resolve by soft binding, per the C2PA decoupled-resolution shape. */
app.get('/v1/manifests', async (c) => {
  const algId = Number(c.req.query('alg'));
  const value = c.req.query('value');
  if (!value) return c.json({ error: 'value is required' }, 400);

  // algId 4 is com.adobe.trustmark.Q: the value IS the recordId.
  if (algId === 4) {
    const record = await chain.record(BigInt(value));
    return record ? c.json(json({ records: [record] })) : c.json({ records: [] });
  }

  // algId 0 is grain.phash.v1, which is ours and unregistered. Say so rather
  // than implying it sits on the C2PA approved list.
  if (algId === 0) {
    const fp = BigInt(value);
    const ids = await chain.candidates(fp);
    const records = await chain.records(ids);
    return c.json(json({ records, note: 'grain.phash.v1 is not a C2PA-registered algorithm' }));
  }

  return c.json({ error: `unsupported soft binding algorithm ${algId}` }, 400);
});

/** The full pipeline. Both paths run; neither is a fallback. */
app.post('/v1/resolve', async (c) => {
  const body = await c.req.parseBody();
  const file = body['image'];
  if (!(file instanceof File)) return c.json({ error: 'expected an image field' }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'image too large' }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());

  let image;
  try {
    image = decodeImage(bytes);
  } catch {
    return c.json({ error: 'unsupported image format: expected PNG or JPEG' }, 415);
  }

  // Both paths, in parallel, on every request -- neither is a fallback
  // (SPEC.md §2). The watermark decode needs only the raw bytes, so it starts
  // immediately rather than waiting on the fingerprint: measured at ~2s against
  // ~0.6s to fingerprint, making it the critical path either way.
  const watermarkPromise = decodeWatermark(bytes, wm);

  const queryFingerprint = fingerprint(image);
  const [watermarkId, candidateIds] = await Promise.all([
    watermarkPromise,
    chain.candidates(queryFingerprint),
  ]);

  const [watermarkRecord, candidates] = await Promise.all([
    watermarkId ? chain.record(watermarkId) : Promise.resolve(null),
    chain.records(candidateIds),
  ]);

  const resolution = resolve({ queryFingerprint, watermarkRecord, candidates });

  return c.json(json({
    ...resolution,
    queryFingerprint: `0x${queryFingerprint.toString(16).padStart(16, '0')}`,
    candidatesExamined: candidates.length,
  }));
});

/**
 * Reserve a recordId and embed the watermark.
 *
 * Registration cannot do this in the browser: TrustMark's JavaScript build is
 * decode-only, so encoding needs the Rust crate. It lives here rather than in
 * the web app because the model must stay resident -- a serverless function
 * would reload 62 MB per request.
 *
 * The id is reserved BEFORE marking because the watermark carries it, and
 * register() takes it as expectedRecordId and reverts if another registration
 * landed first, rather than binding this mark to someone else's record.
 */
app.post('/v1/embed', async (c) => {
  const body = await c.req.parseBody();
  const file = body['image'];
  if (!(file instanceof File)) return c.json({ error: 'expected an image field' }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'image too large' }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    decodeImage(bytes); // reject anything we cannot read before spending a reservation
  } catch {
    return c.json({ error: 'unsupported image format: expected PNG or JPEG' }, 415);
  }

  const recordId = await chain.nextRecordId();
  const marked = await embedWatermark(bytes, recordId, wm);
  if (!marked) return c.json({ error: 'could not watermark that image' }, 500);

  return new Response(marked as unknown as BodyInit, {
    headers: {
      'content-type': 'image/png',
      'x-grain-record-id': recordId.toString(),
      'cache-control': 'no-store',
    },
  });
});

const port = Number(env('PORT', '8787'));
serve({ fetch: app.fetch, port });
console.log(`grain resolver on :${port}`);
console.log(`  registry ${deployments.contracts.GrainRegistry} on chain ${deployments.chainId}`);

export { app };
