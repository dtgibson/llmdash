import test from 'node:test';
import assert from 'node:assert/strict';
import { totalTokens, recordCost, aggregate, projectFiveHour, projectWindow, priceFor } from '../src/stats.js';

test('totalTokens sums every token kind', () => {
  assert.equal(
    totalTokens({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 3, cache_read_input_tokens: 2 }),
    20
  );
});

test('recordCost applies per-model rates', () => {
  assert.equal(recordCost({ input_tokens: 1_000_000 }, 'claude-sonnet-4-6'), 3);
  assert.equal(recordCost({ output_tokens: 1_000_000 }, 'claude-opus-4-8'), 75);
});

test('priceFor falls back to default rates', () => {
  assert.equal(priceFor('mystery-model').input, 3);
  assert.equal(priceFor('claude-haiku-4-5').input, 1);
});

test('aggregate computes tokens, cache hit rate, and session count', () => {
  const recs = [
    { model: 'claude-opus-4-8', sessionId: 'a', usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 900 } },
    { model: 'claude-opus-4-8', sessionId: 'a', usage: { input_tokens: 0, output_tokens: 50 } },
  ];
  const g = aggregate(recs);
  assert.equal(g.sessions, 1);
  assert.equal(g.tokens, 100 + 900 + 50);
  assert.equal(g.cacheHitRate, 900 / 1000);
});

test('projectFiveHour flags comfortable vs at-risk pace', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const resets = now + 3 * 3600_000; // window started 2h ago, resets in 3h
  // 10% used in 2h => slow burn => won't hit before reset
  assert.equal(projectFiveHour(10, resets, now).hitsBeforeReset, false);
  // 80% used in 2h => fast burn => hits before reset
  assert.equal(projectFiveHour(80, resets, now).hitsBeforeReset, true);
  // no data => null
  assert.equal(projectFiveHour(null, null, now), null);
});

test('projectWindow generalizes to the weekly (168h) window; null without a reset time', () => {
  const now = Date.UTC(2026, 0, 4, 0, 0, 0);
  const resets = now + 2 * 24 * 3600_000; // weekly window started 5d ago, resets in 2d
  // 50% used 5 days into a 7-day window => on pace to stay under before reset.
  assert.equal(projectWindow(50, resets, now, 168).hitsBeforeReset, false);
  // 95% used 5 days in => fast burn => hits before the weekly reset.
  assert.equal(projectWindow(95, resets, now, 168).hitsBeforeReset, true);
  // no reset time => null (honest "not available", never a fabricated projection).
  assert.equal(projectWindow(80, null, now, 168), null);
  // projectFiveHour is the same function with the default 5h window.
  assert.equal(projectFiveHour, projectWindow);
});
