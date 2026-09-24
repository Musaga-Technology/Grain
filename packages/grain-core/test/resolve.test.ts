import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, MATCH_THRESHOLD, TAMPER_THRESHOLD, type ResolvedRecord } from '../src/index.ts';

const ANA = '0x1111111111111111111111111111111111111111' as const;
const BOB = '0x2222222222222222222222222222222222222222' as const;

function rec(over: Partial<ResolvedRecord> = {}): ResolvedRecord {
  return {
    recordId: 1n, creator: ANA, fingerprint: 0n,
    registeredAt: 1_700_000_000, revoked: false, ...over,
  };
}

/** Flip n low bits, to sit a fingerprint at a known distance. */
const at = (d: number) => BigInt((1n << BigInt(d)) - 1n);

test('NOT_FOUND when nothing matches — the common case, not a failure', () => {
  assert.deepEqual(resolve({ queryFingerprint: 0n, candidates: [] }), { state: 'NOT_FOUND' });
});

test('NOT_FOUND when the nearest candidate is beyond TAMPER_THRESHOLD', () => {
  const far = rec({ fingerprint: at(TAMPER_THRESHOLD + 1) });
  assert.equal(resolve({ queryFingerprint: 0n, candidates: [far] }).state, 'NOT_FOUND');
});

test('RESOLVED via fingerprint alone', () => {
  const r = resolve({ queryFingerprint: 0n, candidates: [rec({ fingerprint: at(3) })] });
  assert.equal(r.state, 'RESOLVED');
  if (r.state !== 'RESOLVED') return;
  assert.equal(r.via, 'fingerprint');
  assert.equal(r.distance, 3);
});

test('RESOLVED via both when the watermark and the fingerprint agree', () => {
  const record = rec({ fingerprint: at(2) });
  const r = resolve({ queryFingerprint: 0n, watermarkRecord: record, candidates: [record] });
  assert.equal(r.state, 'RESOLVED');
  if (r.state !== 'RESOLVED') return;
  assert.equal(r.via, 'both', 'agreement is worth stating in the UI');
});

test('RESOLVED via watermark when the fingerprint path found nothing', () => {
  // Measured case: a 10% crop keeps the watermark but moves the fingerprint
  // past MATCH_THRESHOLD, so the index no longer returns it as a candidate.
  const record = rec({ fingerprint: at(MATCH_THRESHOLD + 2) });
  const r = resolve({ queryFingerprint: 0n, watermarkRecord: record, candidates: [] });
  assert.equal(r.state, 'RESOLVED');
  if (r.state !== 'RESOLVED') return;
  assert.equal(r.via, 'watermark');
});

test('TAMPERED only past TAMPER_THRESHOLD', () => {
  const justInside = rec({ fingerprint: at(TAMPER_THRESHOLD) });
  const justOutside = rec({ fingerprint: at(TAMPER_THRESHOLD + 1) });

  assert.equal(resolve({ queryFingerprint: 0n, watermarkRecord: justInside, candidates: [] }).state, 'RESOLVED');

  const t = resolve({ queryFingerprint: 0n, watermarkRecord: justOutside, candidates: [] });
  assert.equal(t.state, 'TAMPERED');
  if (t.state !== 'TAMPERED') return;
  assert.equal(t.claimed.recordId, 1n);
});

test('a legitimate 10% crop is NOT accused of tampering', () => {
  // The measured median for a 10% crop is 12 and the worst case 28. At the
  // spec's original threshold of 12 a third of these were reported as stolen
  // credentials. This test is the regression guard for that.
  const record = rec({ fingerprint: at(12) });
  const r = resolve({ queryFingerprint: 0n, watermarkRecord: record, candidates: [] });
  assert.equal(r.state, 'RESOLVED', 'cropping your own photo must not read as theft');
});

test('UNCERTAIN between the thresholds', () => {
  const r = resolve({ queryFingerprint: 0n, candidates: [rec({ fingerprint: at(MATCH_THRESHOLD + 1) })] });
  assert.equal(r.state, 'UNCERTAIN');
  if (r.state !== 'UNCERTAIN') return;
  assert.equal(r.candidates.length, 1);
});

test('no confidence percentage appears anywhere in a result', () => {
  const results = [
    resolve({ queryFingerprint: 0n, candidates: [] }),
    resolve({ queryFingerprint: 0n, candidates: [rec({ fingerprint: at(3) })] }),
    resolve({ queryFingerprint: 0n, candidates: [rec({ fingerprint: at(10) })] }),
    resolve({ queryFingerprint: 0n, watermarkRecord: rec({ fingerprint: at(40) }), candidates: [] }),
  ];
  for (const r of results) {
    const keys = JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    assert.ok(!/confidence|percent|score/i.test(keys), `leaked a confidence field: ${keys}`);
  }
});

test('ties break toward the earliest registration', () => {
  // The registry does not deduplicate by fingerprint on purpose; block order
  // is the only neutral arbiter when two creators register similar images.
  const later = rec({ recordId: 9n, creator: BOB, fingerprint: at(2), registeredAt: 1_700_000_500 });
  const earlier = rec({ recordId: 4n, creator: ANA, fingerprint: at(2), registeredAt: 1_700_000_100 });
  const r = resolve({ queryFingerprint: 0n, candidates: [later, earlier] });
  assert.equal(r.state, 'RESOLVED');
  if (r.state !== 'RESOLVED') return;
  assert.equal(r.record.recordId, 4n);
});

test('revoked records are never returned', () => {
  const revoked = rec({ fingerprint: at(1), revoked: true });
  assert.equal(resolve({ queryFingerprint: 0n, candidates: [revoked] }).state, 'NOT_FOUND');
  // Nor via the watermark path.
  assert.equal(resolve({ queryFingerprint: 0n, watermarkRecord: revoked, candidates: [] }).state, 'NOT_FOUND');
});
