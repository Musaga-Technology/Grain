import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RECORD_ID, TRUSTMARK_VERSIONS, TRUSTMARK_VERSION,
  isWatermarkable, aspectRatioWarning,
} from '../src/index.ts';

test('BCH_SUPER trades capacity for error correction, which is the scarce resource', () => {
  const sup = TRUSTMARK_VERSIONS.BCH_SUPER;
  for (const [name, v] of Object.entries(TRUSTMARK_VERSIONS)) {
    if (name === 'BCH_SUPER') continue;
    assert.ok(sup.dataBits < v.dataBits, `${name} should carry more data than BCH_SUPER`);
    assert.ok(sup.correctableFlips > v.correctableFlips, `BCH_SUPER should out-correct ${name}`);
  }
  assert.equal(TRUSTMARK_VERSION, 'BCH_SUPER');
});

test('every version accounts for all 100 payload bits (4 of them the version tag)', () => {
  for (const [name, v] of Object.entries(TRUSTMARK_VERSIONS)) {
    assert.equal(v.dataBits + v.eccBits + 4, 100, `${name} does not sum to 100`);
  }
});

test('MAX_RECORD_ID is the 40-bit ceiling BCH_SUPER can carry', () => {
  assert.equal(MAX_RECORD_ID, 1099511627775n);
  assert.equal(MAX_RECORD_ID, (1n << BigInt(TRUSTMARK_VERSIONS.BCH_SUPER.dataBits)) - 1n);
});

test('recordIds outside the watermarkable range are refused', () => {
  // recordId 0 is the null id (SPEC.md 6.2), so it is never watermarkable.
  assert.equal(isWatermarkable(0n), false);
  assert.equal(isWatermarkable(1n), true);
  assert.equal(isWatermarkable(MAX_RECORD_ID), true);
  assert.equal(isWatermarkable(MAX_RECORD_ID + 1n), false);
});

test('aspect ratios past 2:1 are flagged in either orientation', () => {
  assert.equal(aspectRatioWarning(1000, 1000), false);
  assert.equal(aspectRatioWarning(2000, 1000), false); // exactly 2.0 is allowed
  assert.equal(aspectRatioWarning(2001, 1000), true);
  assert.equal(aspectRatioWarning(1000, 2001), true);
});
