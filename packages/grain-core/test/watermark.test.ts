import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RECORD_ID, TRUSTMARK_VERSIONS, TRUSTMARK_VERSION,
  isWatermarkable, aspectRatioWarning,
} from '../src/index.ts';

test('ships BCH_5: the scheme every Adobe implementation agrees on', () => {
  // BCH_SUPER corrects more, but Adobe's Rust crate computes its parity
  // differently from the Python reference. BCH_5's data fills whole 32-bit
  // words, so no implementation can disagree about it.
  assert.equal(TRUSTMARK_VERSION, 'BCH_5');
  assert.equal(TRUSTMARK_VERSIONS.BCH_5.dataBits % 8 === 5, true, '61 bits pad to 8 bytes, two whole words');
  assert.ok(TRUSTMARK_VERSIONS.BCH_5.dataBits >= 40, 'a 40-bit recordId must fit');
});

test('every version accounts for all 100 payload bits (4 of them the version tag)', () => {
  for (const [name, v] of Object.entries(TRUSTMARK_VERSIONS)) {
    assert.equal(v.dataBits + v.eccBits + 4, 100, `${name} does not sum to 100`);
  }
});

test('MAX_RECORD_ID is the 40-bit ceiling Grain writes', () => {
  assert.equal(MAX_RECORD_ID, 1099511627775n);
  assert.equal(MAX_RECORD_ID, (1n << 40n) - 1n);
});

test('recordIds outside the watermarkable range are refused', () => {
  // recordId 0 is the null id, so it is never watermarkable.
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
