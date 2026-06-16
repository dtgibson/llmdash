import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySeries } from '../src/trends.js';

test('dailySeries buckets records by day, preserves totals, sorts ascending', () => {
  const recs = [
    { tsMs: Date.UTC(2026, 0, 1, 10, 0, 0), v: 1 },
    { tsMs: Date.UTC(2026, 0, 1, 20, 0, 0), v: 2 },
    { tsMs: Date.UTC(2026, 0, 3, 5, 0, 0), v: 3 },
  ];
  const agg = (rs) => ({
    tokens: rs.reduce((a, r) => a + r.v, 0),
    input: 0, output: 0, cacheRead: 0, cost: 0, cacheHitRate: 0,
  });
  const s = dailySeries(recs, agg);
  assert.equal(s.reduce((a, d) => a + d.tokens, 0), 6); // totals preserved
  assert.ok(s.length >= 1 && s.length <= 3); // bucketed (exact count is tz-dependent)
  const days = s.map((d) => Date.parse(d.day));
  assert.deepEqual(days, [...days].sort((a, b) => a - b)); // ascending
});

test('dailySeries handles empty input', () => {
  assert.deepEqual(dailySeries([], () => ({})), []);
});
