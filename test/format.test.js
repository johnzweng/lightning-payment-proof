import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatBtc, formatDuration, formatFee, formatRelative, formatSats, formatUtc, shortHex,
} from '../public/assets/ui/format.js';

test('amounts in sats keep millisatoshis', () => {
  assert.equal(formatSats(28605000n), '28,605 sats');
  assert.equal(formatSats(1000n), '1 sat');
  assert.equal(formatSats(1500n), '1.5 sats');
  assert.equal(formatSats(1n), '0.001 sats');
});

test('amounts in BTC are exact', () => {
  assert.equal(formatBtc(28605000n), '0.00028605 BTC');
  assert.equal(formatBtc(100_000_000_000n), '1 BTC');
  assert.equal(formatBtc(1n), '0.00000000001 BTC');
});

test('route-hint fees', () => {
  assert.equal(formatFee(1000, 2500), '1 sat + 0.25 %');
  assert.equal(formatFee(4_000_000_000, 40_000), '4,000,000 sat + 4 %');
});

test('durations and relative times', () => {
  assert.equal(formatDuration(86400), '1 day');
  assert.equal(formatDuration(5400), '90 minutes');
  assert.equal(formatDuration(61), '61 seconds');
  assert.equal(formatRelative(0, 3 * 86400), '3 days ago');
  assert.equal(formatRelative(7200, 0), 'in 2 hours');
  assert.equal(formatRelative(10, 0), 'this minute');
});

test('dates and hex', () => {
  assert.equal(formatUtc(1790749919), '2026-09-30 06:31:59 UTC');
  assert.equal(shortHex('0123456789abcdef0123'), '01234567…cdef0123');
  assert.equal(shortHex('abc'), 'abc');
});
