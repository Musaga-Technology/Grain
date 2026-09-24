import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import {
  encodeCbor, buildManifest, encodeManifest, manifestHash,
  signManifest, verifyManifest, GRAIN_PHASH_ALG, TRUSTMARK_ALG,
} from '../src/index.ts';

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const account = privateKeyToAccount(KEY);

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

test('CBOR: integers use the shortest form', () => {
  assert.equal(hex(encodeCbor(0)), '00');
  assert.equal(hex(encodeCbor(23)), '17');
  assert.equal(hex(encodeCbor(24)), '1818');
  assert.equal(hex(encodeCbor(255)), '18ff');
  assert.equal(hex(encodeCbor(256)), '190100');
  assert.equal(hex(encodeCbor(65536)), '1a00010000');
  assert.equal(hex(encodeCbor(2n ** 32n)), '1b0000000100000000');
  assert.equal(hex(encodeCbor(-1)), '20');
});

test('CBOR: map keys sort by encoded bytes, length first', () => {
  // "b" is shorter than "aa", so it sorts first regardless of alphabet.
  const a = encodeCbor({ aa: 1, b: 2 });
  const b = encodeCbor({ b: 2, aa: 1 });
  assert.equal(hex(a), hex(b), 'insertion order must not affect the encoding');
  assert.equal(hex(a), 'a2616202626161 01'.replace(/ /g, ''));
});

test('CBOR: absent and null fields encode differently', () => {
  // If these collided, dropping an optional field would not change the hash
  // and a manifest could be altered without invalidating its signature.
  assert.notEqual(hex(encodeCbor({ a: 1, b: undefined })), hex(encodeCbor({ a: 1, b: null })));
  assert.equal(hex(encodeCbor({ a: 1, b: undefined })), hex(encodeCbor({ a: 1 })));
});

test('CBOR: refuses floats rather than encoding them', () => {
  assert.throws(() => encodeCbor(1.5), /non-integer/);
});

test('manifest always carries the fingerprint, watermark or not', () => {
  const withWm = buildManifest({ recordId: 1n, creator: account.address, fingerprint: 0xabcdn });
  const noWm = buildManifest({
    recordId: 2n, creator: account.address, fingerprint: 0xabcdn, watermarked: false,
  });

  assert.ok(withWm.assertions.softBindings.some((s) => s.alg === GRAIN_PHASH_ALG));
  assert.ok(withWm.assertions.softBindings.some((s) => s.alg === TRUSTMARK_ALG));
  // No watermark (e.g. aspect ratio past 2:1) still means a fingerprint binding.
  assert.ok(noWm.assertions.softBindings.some((s) => s.alg === GRAIN_PHASH_ALG));
  assert.ok(!noWm.assertions.softBindings.some((s) => s.alg === TRUSTMARK_ALG));
});

test('grain.phash.v1 is declared unregistered', () => {
  const m = buildManifest({ recordId: 1n, creator: account.address, fingerprint: 1n });
  const ours = m.assertions.softBindings.find((s) => s.alg === GRAIN_PHASH_ALG)!;
  const theirs = m.assertions.softBindings.find((s) => s.alg === TRUSTMARK_ALG)!;
  assert.equal(ours.algId, 0, 'ours is not on the C2PA approved list and must say so');
  assert.equal(theirs.algId, 4, 'com.adobe.trustmark.Q is identifier 4');
});

test('hash is stable across field ordering and excludes the signature', async () => {
  const base = buildManifest({
    recordId: 7n, creator: account.address, fingerprint: 0xdeadbeefn,
    createdAt: 1_700_000_000, title: 'Harbour at dusk',
  });
  const before = manifestHash(base);
  const signed = await signManifest(base, KEY);

  assert.equal(manifestHash(signed), before, 'signing must not change the hash it signs');
  assert.ok(!hex(encodeManifest(signed)).includes(signed.signature!.slice(2)),
    'the signature must not appear in the hashed bytes');
});

test('sign and verify round-trip', async () => {
  const m = buildManifest({ recordId: 3n, creator: account.address, fingerprint: 0x1234n });
  const signed = await signManifest(m, KEY);
  assert.ok(await verifyManifest(signed));
});

test('tampering with any field invalidates the signature', async () => {
  const m = await signManifest(
    buildManifest({ recordId: 3n, creator: account.address, fingerprint: 0x1234n, title: 'real' }),
    KEY,
  );
  assert.ok(await verifyManifest(m));

  const retitled = { ...m, assertions: { ...m.assertions, title: 'forged' } };
  assert.equal(await verifyManifest(retitled), false, 'a changed title must break verification');

  const reidentified = { ...m, recordId: 9n };
  assert.equal(await verifyManifest(reidentified), false, 'a changed recordId must break verification');
});

test('unsigned manifests do not verify', async () => {
  const m = buildManifest({ recordId: 1n, creator: account.address, fingerprint: 1n });
  assert.equal(await verifyManifest(m), false);
});

test('signing with the wrong key is refused rather than producing a bad manifest', async () => {
  const m = buildManifest({ recordId: 1n, creator: '0x0000000000000000000000000000000000000001', fingerprint: 1n });
  await assert.rejects(() => signManifest(m, KEY), /does not match manifest creator/);
});
