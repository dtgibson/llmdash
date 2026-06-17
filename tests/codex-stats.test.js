import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, codexPriceFor, recordCost, usageFromEvent } from '../src/codex-stats.js';

test('codexPriceFor matches model families and falls back', () => {
  assert.equal(codexPriceFor('gpt-5-codex').output, 10);
  assert.equal(codexPriceFor('o4-mini').output, 4.4);
  assert.equal(codexPriceFor('gpt-5.5').output, 10); // substring-matches the gpt-5 entry
  assert.equal(codexPriceFor('mystery').output, 10); // default
});

test('usageFromEvent parses the real payload.info.last_token_usage shape', () => {
  // Real Codex token_count event: tokens nest under payload.info.last_token_usage
  // (the per-turn delta). The old parser read info top-level and got nothing.
  const r = usageFromEvent({
    timestamp: '2026-06-16T22:00:00Z',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 200, reasoning_output_tokens: 80, total_tokens: 1200 },
        total_token_usage: { input_tokens: 5000, cached_input_tokens: 4500, output_tokens: 800, total_tokens: 5800 },
      },
    },
  });
  assert.equal(r.input, 1000);
  assert.equal(r.cached, 900);
  assert.equal(r.output, 200);
  assert.equal(r.reasoning, 80);
});

test('usageFromEvent still parses the legacy token_count.usage shape; null when empty', () => {
  const r = usageFromEvent({
    model: 'gpt-5-codex',
    timestamp: '2026-06-16T00:00:00Z',
    token_count: { usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 90 } },
  });
  assert.equal(r.input, 100);
  assert.equal(r.output, 50);
  assert.equal(r.cached, 90);
  assert.equal(usageFromEvent({ token_count: { usage: {} } }), null);
  // A non-usage event (e.g. turn_context) yields no record.
  assert.equal(usageFromEvent({ payload: { type: 'turn_context', model: 'gpt-5.5' } }), null);
});

test('aggregate treats cached as a SUBSET of input (no double-count)', () => {
  // input 1000 (of which 900 cached), output 200.
  const g = aggregate([{ model: 'gpt-5', input: 1000, output: 200, cached: 900, sessionId: 'a' }]);
  assert.equal(g.tokens, 1200);          // input + output, NOT + cached
  assert.equal(g.cacheRead, 900);
  assert.equal(g.cacheHitRate, 900 / 1000); // cached / input
});

test('recordCost bills non-cached input + cached-at-cache-rate + output', () => {
  // gpt-5 rates per 1M: input 1.25, output 10, cacheRead 0.125.
  const r = { model: 'gpt-5', input: 1000, output: 200, cached: 900 };
  const expected = ((1000 - 900) * 1.25 + 900 * 0.125 + 200 * 10) / 1e6;
  assert.ok(Math.abs(recordCost(r) - expected) < 1e-12);
  // Must be cheaper than the old bug (full input + cached billed separately).
  const buggy = (1000 * 1.25 + 200 * 10 + 900 * 0.125) / 1e6;
  assert.ok(recordCost(r) < buggy);
});

test('usageFromEvent is null-safe on primitive / non-object lines (no throw)', () => {
  // A malformed JSONL line (a bare null/number/string/array) must not crash parsing.
  for (const bad of [null, 5, true, 'x', []]) {
    assert.equal(usageFromEvent(bad), null);
  }
});
