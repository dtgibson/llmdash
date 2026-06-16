import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, codexPriceFor, usageFromEvent } from '../src/codex-stats.js';

test('codexPriceFor matches model families and falls back', () => {
  assert.equal(codexPriceFor('gpt-5-codex').output, 10);
  assert.equal(codexPriceFor('o4-mini').output, 4.4);
  assert.equal(codexPriceFor('mystery').output, 10); // default
});

test('usageFromEvent parses common shapes; null when empty', () => {
  const r = usageFromEvent({
    model: 'gpt-5-codex',
    timestamp: '2026-06-16T00:00:00Z',
    token_count: { usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 900 } },
  });
  assert.equal(r.input, 100);
  assert.equal(r.output, 50);
  assert.equal(r.cached, 900);
  assert.equal(usageFromEvent({ token_count: { usage: {} } }), null);
});

test('aggregate computes tokens, cache hit rate, and cost', () => {
  const g = aggregate([{ model: 'gpt-5-codex', input: 100, output: 50, cached: 900, sessionId: 'a' }]);
  assert.equal(g.tokens, 1050);
  assert.equal(g.cacheRead, 900);
  assert.equal(g.cacheHitRate, 900 / 1000);
  const expected = (100 * 1.25 + 50 * 10 + 900 * 0.125) / 1e6;
  assert.ok(Math.abs(g.cost - expected) < 1e-12);
});
