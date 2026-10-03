import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDIT_BALANCE_MAX_CODE_POINTS, CREDIT_EXPIRY_STATUSES, boundedCreditBalance,
  creditExpiryFromIso, creditExpiryNotReported, unsupportedCredits,
} from '../src/account-credits.js';

// The one balance sanitizer both trust boundaries (local Codex ingest and the
// peer normalizer) import, so these cases hold at each (FR-10, FR-11, NFR-03).
test('the opaque credit balance is stripped, trimmed, bounded, and never coerced (QA-11, QA-12)', () => {
  assert.equal(boundedCreditBalance('\u202e12\u200b.50\n'), '12.50');
  const long = 'é'.repeat(30) + '9'.repeat(70);
  assert.equal(boundedCreditBalance(long), [...long].slice(0, 64).join(''));
  assert.equal([...boundedCreditBalance(long)].length, CREDIT_BALANCE_MAX_CODE_POINTS);
  assert.equal(boundedCreditBalance('  '), null, 'empty after stripping is absent, not a value');
  assert.equal(boundedCreditBalance('\u2028\u2029\u0007'), null);
  assert.equal(boundedCreditBalance(12.5), undefined, 'a number is ignored so the prior observation is retained');
  assert.equal(boundedCreditBalance(null), undefined);
  assert.equal(boundedCreditBalance('0'), '0', 'an explicit zero stays the literal string');
});

test('every unsupported block has the fixed four-key shape (FR-01)', () => {
  const block = unsupportedCredits('not-reported');
  assert.deepEqual(block, { status: 'unsupported', reason: 'not-reported', balance: null, capturedAt: null });
  assert.notEqual(unsupportedCredits('not-reported'), block, 'each call is detached');
});

// The expiry vocabulary has one home both trust boundaries import (FR-11, FR-12,
// QA-12, QA-13): canonical ISO, strictly future, otherwise the disclosed absence,
// and never "now".
test('a credit expiry is a canonical future instant or the disclosed absence, never now (QA-13)', () => {
  const nowMs = Date.UTC(2026, 9, 2, 12, 0, 0);
  assert.deepEqual([...CREDIT_EXPIRY_STATUSES].sort(), ['not-reported', 'reported']);
  assert.deepEqual(creditExpiryNotReported(), { status: 'not-reported' });
  assert.notEqual(creditExpiryNotReported(), creditExpiryNotReported(), 'each call is detached');
  assert.deepEqual(creditExpiryFromIso('2026-11-01T09:00:00-07:00', nowMs),
    { status: 'reported', expiresAt: '2026-11-01T16:00:00.000Z' }, 're-normalized to canonical ISO');
  const nowIso = new Date(nowMs).toISOString();
  for (const value of [nowIso, '2026-10-01T00:00:00Z', 'next tuesday', '', 1_793_000_000, null, undefined, {}]) {
    const result = creditExpiryFromIso(value, nowMs);
    assert.deepEqual(result, { status: 'not-reported' }, `${JSON.stringify(value)} is not a current reported expiry`);
    assert.notEqual(result.expiresAt, nowIso);
  }
  assert.deepEqual(creditExpiryFromIso('2026-11-01T16:00:00Z', NaN), { status: 'not-reported' },
    'an unusable clock never lets an instant through');
});
